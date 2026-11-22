// VANTARA (AGPL-3.0-only) — طبقة تحويل إضافات Mihon لويندوز قبل محرك Suwayomi.
//
// Suwayomi يحوّل APK الإضافة إلى JVM بـdex2jar، فيفشل على إضافات Keiyoushi الحالية المحسّنة بـR8: R8 يحذف المُنشئ
// الذي لا يفعل إلا استدعاء مُنشئ الأب، ويكتب في DEX «new-instance C» ثم «invoke-direct P.<init>» (P أب C: Object أو
// Enum أو Filter.Select...). هذا سليم في ART وممنوع في JVM، وdex2jar يدمج الاثنين في «new P» فيضيع C نفسه، فيرفض
// مدقق JVM الكود (VerifyError) أو يفشل وقت التشغيل (ويندوز حقيقي: Team X وMangaSwat وAzora وMangaDex).
//
// الإصلاح من المصدر لا بالتخمين، بنفس مكتبات Suwayomi (dex2jar وASM وapk-parser من ملفه، بلا تنزيل):
//   1) قبل التحويل، في تعليمات DEX نفسها: «invoke-direct P.<init>» على قيمة «new-instance C» يصير «C.<init>»،
//      ومُنشئ يقفز من C إلى جدّه يصير مُنشئ أبيه المباشر. النوع الحقيقي مكتوب في DEX فلا تخمين.
//   2) يُعاد لكل C المُنشئ المحذوف بنفس الوصف (يمرر للأب كما كان R8 سيفعل لو أبقاه).
//   3) الإطارات تُحسب بتسلسل أصناف كامل: الإضافة ثم مكتبات Suwayomi (طبقة أندرويد وokhttp وkotlin)، بلا تحميل أي صنف.
//   4) jar جاهز: الأصناف + AndroidManifest.xml نصيًا + resources.arsc وres وassets، ثم خطوة Suwayomi نفسها
//      (BytecodeEditor.fixAndroidClasses) كما تُطبَّق على APK، فيثبّته Suwayomi كما هو.
// التشغيل: java -cp "Suwayomi-Server.jar;vantara-extension-jar.jar" VantaraExtensionJar <in.apk> <out.jar>
// المخرج آخر سطر JSON: {"ok":true,"classes":N,"retargeted":N,"addedCtors":N,"unresolved":N} أو {"ok":false,"error":"..."}.
import com.googlecode.d2j.Method;
import com.googlecode.d2j.dex.Dex2jar;
import com.googlecode.d2j.reader.BaseDexFileReader;
import com.googlecode.d2j.reader.MultiDexFileReader;
import com.googlecode.d2j.reader.Op;
import com.googlecode.d2j.visitors.DexClassVisitor;
import com.googlecode.d2j.visitors.DexCodeVisitor;
import com.googlecode.d2j.visitors.DexFileVisitor;
import com.googlecode.d2j.visitors.DexMethodVisitor;
import com.googlecode.dex2jar.tools.BaksmaliBaseDexExceptionHandler;
import net.dongliu.apk.parser.ApkFile;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;
import suwayomi.tachidesk.manga.impl.util.BytecodeEditor;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

public final class VantaraExtensionJar {
    private static final String OBJECT = "java/lang/Object";
    /** مُنشئات حذفها R8 وأعدنا استدعاءها: {الصنف، الأب الذي يملك المُنشئ أصلًا، الوصف}. */
    private static final Set<List<String>> restore = new LinkedHashSet<>();
    private static int retargeted = 0, addedCtors = 0;
    private static final boolean DEBUG = System.getenv("VX_DEBUG") != null;

    public static void main(String[] args) {
        try {
            if (args.length != 2) throw new IllegalArgumentException("usage: <in.apk> <out.jar>");
            Path apk = Path.of(args[0]), out = Path.of(args[1]);
            byte[] apkBytes = Files.readAllBytes(apk);
            Map<String, ClassNode> nodes = new LinkedHashMap<>();
            for (byte[] bytes : translate(apk).values()) {
                ClassNode node = new ClassNode();
                new ClassReader(bytes).accept(node, ClassReader.SKIP_FRAMES);
                nodes.put(node.name, node);
            }
            for (List<String> r : restore) ensureConstructor(r.get(0), r.get(1), r.get(2), nodes);
            int unresolved = 0;
            // استدعاء مُنشئ غير موجود في صنف من الإضافة = موضع لم نصلحه (يفشل عند تنفيذه وحده؛ يُعدّ للتقرير)
            for (ClassNode node : nodes.values()) for (MethodNode m : node.methods) for (var insn : m.instructions) {
                if (!(insn instanceof MethodInsnNode) || insn.getOpcode() != Opcodes.INVOKESPECIAL) continue;
                MethodInsnNode call = (MethodInsnNode) insn;
                ClassNode target = nodes.get(call.owner);
                if (!"<init>".equals(call.name) || target == null || hasConstructor(target, call.desc)) continue;
                unresolved++;
                if (DEBUG) System.err.println("unresolved " + call.owner + "." + call.desc + " in " + node.name + "." + m.name);
            }
            Hierarchy hierarchy = new Hierarchy(nodes, VantaraExtensionJar.class.getClassLoader());
            Map<String, byte[]> fixed = new LinkedHashMap<>();
            for (ClassNode node : nodes.values()) {
                ClassWriter writer = new ClassWriter(ClassWriter.COMPUTE_FRAMES | ClassWriter.COMPUTE_MAXS) {
                    @Override protected String getCommonSuperClass(String a, String b) { return hierarchy.common(a, b); }
                };
                node.accept(writer);
                fixed.put(node.name + ".class", writer.toByteArray());
            }
            String manifest;
            try (ApkFile parsed = new ApkFile(apk.toFile())) { manifest = parsed.getManifestXml(); }
            writeJar(out, fixed, manifest, apkBytes);
            System.out.println("{\"ok\":true,\"classes\":" + fixed.size() + ",\"retargeted\":" + retargeted + ",\"addedCtors\":" + addedCtors + ",\"unresolved\":" + unresolved + "}");
        } catch (Throwable t) {
            String message = t.getMessage() == null ? t.getClass().getName() : t.getClass().getSimpleName() + ": " + t.getMessage();
            System.out.println("{\"ok\":false,\"error\":" + json(message.length() > 400 ? message.substring(0, 400) : message) + "}");
            System.exit(2);
        }
    }

    /** نفس خيارات Suwayomi (PackageTools.dex2jar) مع مصحح DEX قبلها، وبلا حساب إطارات (يُحسب بعد الإصلاح). */
    private static Map<String, byte[]> translate(Path apk) throws Exception {
        Path tmp = Files.createTempFile("vantara-d2j-", ".jar");
        try {
            byte[] dex;
            try (ZipFile zip = new ZipFile(apk.toFile())) {
                ZipEntry entry = zip.getEntry("classes.dex");
                if (entry == null) throw new IllegalStateException("APK بلا classes.dex");
                try (InputStream in = zip.getInputStream(entry)) { dex = in.readAllBytes(); }
            }
            BaksmaliBaseDexExceptionHandler handler = new BaksmaliBaseDexExceptionHandler();
            Dex2jar.from(fixing(MultiDexFileReader.open(dex))).withExceptionHandler(handler)
                .reUseReg(false).topoLogicalSort().skipDebug(true).optimizeSynchronized(false).printIR(false)
                .noCode(false).skipExceptions(false).dontSanitizeNames(true).computeFrames(false)
                .to(tmp);
            if (handler.hasException()) throw new IllegalStateException("تعذّر تحويل بعض أصناف الإضافة");
            Map<String, byte[]> out = new LinkedHashMap<>();
            try (ZipInputStream in = new ZipInputStream(Files.newInputStream(tmp))) {
                for (ZipEntry e; (e = in.getNextEntry()) != null; ) if (e.getName().endsWith(".class")) out.put(e.getName(), in.readAllBytes());
            }
            if (out.isEmpty()) throw new IllegalStateException("لم يخرج أي صنف من التحويل");
            return out;
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    // ---------- الخطوة 1: تصحيح DEX ----------

    private static BaseDexFileReader fixing(BaseDexFileReader inner) {
        return new BaseDexFileReader() {
            @Override public int getDexVersion() { return inner.getDexVersion(); }
            @Override public List<String> getClassNames() { return inner.getClassNames(); }
            @Override public void accept(DexFileVisitor dv) { inner.accept(wrap(dv)); }
            @Override public void accept(DexFileVisitor dv, int config) { inner.accept(wrap(dv), config); }
            @Override public void accept(DexFileVisitor dv, int classIdx, int config) { inner.accept(wrap(dv), classIdx, config); }
        };
    }

    private static DexFileVisitor wrap(DexFileVisitor dv) {
        return new DexFileVisitor(dv) {
            @Override public DexClassVisitor visit(int access, String className, String superClass, String[] interfaces) {
                DexClassVisitor cv = super.visit(access, className, superClass, interfaces);
                if (cv == null) return null;
                return new DexClassVisitor(cv) {
                    @Override public DexMethodVisitor visitMethod(int acc, Method method) {
                        DexMethodVisitor mv = super.visitMethod(acc, method);
                        if (mv == null) return null;
                        return new DexMethodVisitor(mv) {
                            @Override public DexCodeVisitor visitCode() {
                                DexCodeVisitor code = super.visitCode();
                                return code == null ? null : new ConstructorFixer(code, className, superClass, method, (acc & Opcodes.ACC_STATIC) != 0);
                            }
                        };
                    }
                };
            }
        };
    }

    /**
     * يتتبع «new-instance» لكل سجل بترتيب الكود (أي كتابة أخرى للسجل تمسحه)، فإن جاء بعده
     * «invoke-direct X.<init>» على نفس السجل وX ليس صنف القيمة، يُستدعى مُنشئ صنفها. والمُنشئ الذي يهيّئ this بمُنشئ
     * جدّه يُستدعى فيه مُنشئ الأب المباشر. علامات القفز لا تمسح التتبع: مدقق ART نفسه يشترط أن القيمة غير المهيأة
     * في invoke-direct آتية من «new-instance» واحد على كل المسارات (وإلا يرفض الإضافة على الجوال أصلًا)، والكود بين
     * الاثنين كثيرًا ما يتفرع لبناء الوسائط (قوائم الفلاتر).
     */
    private static final class ConstructorFixer extends DexCodeVisitor {
        private final String className, superClass;
        private final Method method;
        private final boolean isStatic;
        private final Map<Integer, String> made = new HashMap<>();
        private int thisReg = -1;

        ConstructorFixer(DexCodeVisitor next, String className, String superClass, Method method, boolean isStatic) {
            super(next);
            this.className = className; this.superClass = superClass; this.method = method; this.isStatic = isStatic;
        }

        @Override public void visitRegister(int total) {
            if (!isStatic && "<init>".equals(method.getName())) {
                int ins = 1;
                for (String p : method.getParameterTypes()) ins += p.equals("J") || p.equals("D") ? 2 : 1;
                thisReg = total - ins;
            }
            super.visitRegister(total);
        }

        /** كتابة في سجل (وفي السجل التالي إن كانت القيمة مزدوجة long/double). */
        private void forget(Op op, int reg) {
            String n = op.name();
            boolean wide = n.contains("WIDE") || n.endsWith("_LONG") || n.endsWith("_DOUBLE") || n.contains("_LONG_") || n.contains("_DOUBLE_");
            if (DEBUG && made.containsKey(reg)) System.err.println("forget " + made.get(reg) + " by " + op + " in " + className + "." + method.getName());
            made.remove(reg);
            if (wide) made.remove(reg + 1);
            if (reg == thisReg || (wide && reg + 1 == thisReg)) thisReg = -1;
        }

        @Override public void visitTypeStmt(Op op, int a, int b, String type) {
            forget(op, a);
            if (op == Op.NEW_INSTANCE) made.put(a, type);
            super.visitTypeStmt(op, a, b, type);
        }

        @Override public void visitMethodStmt(Op op, int[] args, Method m) {
            if ((op == Op.INVOKE_DIRECT || op == Op.INVOKE_DIRECT_RANGE) && "<init>".equals(m.getName()) && args.length > 0) {
                String made = this.made.remove(args[0]);
                String target = null;
                if (made != null && !made.equals(m.getOwner())) target = made;
                else if (made == null && args[0] == thisReg && superClass != null && !m.getOwner().equals(className) && !m.getOwner().equals(superClass)) target = superClass;
                if (target != null) {
                    restore.add(List.of(internal(target), internal(m.getOwner()), m.getDesc()));
                    m = new Method(target, "<init>", m.getParameterTypes(), m.getReturnType());
                    retargeted++;
                }
            }
            super.visitMethodStmt(op, args, m);
        }

        // كل ما يكتب في سجل ينهي تتبعه
        @Override public void visitConstStmt(Op op, int a, Object value) { forget(op, a); super.visitConstStmt(op, a, value); }
        @Override public void visitStmt1R(Op op, int a) { forget(op, a); super.visitStmt1R(op, a); }
        @Override public void visitStmt2R(Op op, int a, int b) {
            String copied = op.name().startsWith("MOVE_OBJECT") ? made.get(b) : null;
            forget(op, a);
            if (copied != null) made.put(a, copied);
            super.visitStmt2R(op, a, b);
        }

        // القفز يحمل حالة السجلات إلى هدفه (كتل الكوروتين: القيمة تُصنع في كتلة ويُهيَّأ في أخرى بعد قفزة)
        private final Map<com.googlecode.d2j.DexLabel, Map<Integer, String>> pending = new HashMap<>();
        private void carry(com.googlecode.d2j.DexLabel to) {
            if (made.isEmpty()) return;
            Map<Integer, String> at = pending.computeIfAbsent(to, x -> new HashMap<>());
            for (Map.Entry<Integer, String> e : made.entrySet()) at.putIfAbsent(e.getKey(), e.getValue());
        }
        @Override public void visitJumpStmt(Op op, int a, int b, com.googlecode.d2j.DexLabel label) { carry(label); super.visitJumpStmt(op, a, b, label); }
        @Override public void visitPackedSwitchStmt(Op op, int a, int first, com.googlecode.d2j.DexLabel[] labels) { for (com.googlecode.d2j.DexLabel l : labels) carry(l); super.visitPackedSwitchStmt(op, a, first, labels); }
        @Override public void visitSparseSwitchStmt(Op op, int a, int[] cases, com.googlecode.d2j.DexLabel[] labels) { for (com.googlecode.d2j.DexLabel l : labels) carry(l); super.visitSparseSwitchStmt(op, a, cases, labels); }
        @Override public void visitLabel(com.googlecode.d2j.DexLabel label) {
            Map<Integer, String> in = pending.remove(label);
            if (in != null) for (Map.Entry<Integer, String> e : in.entrySet()) made.putIfAbsent(e.getKey(), e.getValue());
            super.visitLabel(label);
        }
        @Override public void visitStmt3R(Op op, int a, int b, int c) { forget(op, a); super.visitStmt3R(op, a, b, c); }
        @Override public void visitStmt2R1N(Op op, int a, int b, int n) { forget(op, a); super.visitStmt2R1N(op, a, b, n); }
        @Override public void visitFieldStmt(Op op, int a, int b, com.googlecode.d2j.Field field) { forget(op, a); super.visitFieldStmt(op, a, b, field); }

    }

    private static String internal(String dexType) {
        return dexType.startsWith("L") && dexType.endsWith(";") ? dexType.substring(1, dexType.length() - 1) : dexType;
    }

    // ---------- الخطوة 2: إعادة المُنشئات المحذوفة ----------

    private static boolean hasConstructor(ClassNode node, String desc) {
        for (MethodNode m : node.methods) if ("<init>".equals(m.name) && desc.equals(m.desc)) return true;
        return false;
    }

    /**
     * مُنشئ T بالوصف desc يمرر لأبيه بنفس الوسائط، صعودًا حتى الأب X الذي يملكه أصلًا. كل صنف في الطريق يجب أن يكون
     * من الإضافة (لا نضيف شيئًا لمكتبة)؛ وإلا لا تعديل.
     */
    private static void ensureConstructor(String t, String x, String desc, Map<String, ClassNode> own) {
        List<ClassNode> path = new ArrayList<>();
        for (String at = t; !at.equals(x); ) {
            ClassNode node = own.get(at);
            if (node == null || node.superName == null || path.size() > 32) return;
            path.add(node);
            at = node.superName;
        }
        for (int k = path.size() - 1; k >= 0; k--) {
            ClassNode node = path.get(k);
            boolean has = false;
            for (MethodNode m : node.methods) has |= "<init>".equals(m.name) && desc.equals(m.desc);
            if (has) continue;
            MethodNode ctor = new MethodNode(Opcodes.ACC_PUBLIC | Opcodes.ACC_SYNTHETIC, "<init>", desc, null, null);
            ctor.instructions.add(new VarInsnNode(Opcodes.ALOAD, 0));
            int slot = 1;
            for (Type arg : Type.getArgumentTypes(desc)) { ctor.instructions.add(new VarInsnNode(arg.getOpcode(Opcodes.ILOAD), slot)); slot += arg.getSize(); }
            ctor.instructions.add(new MethodInsnNode(Opcodes.INVOKESPECIAL, node.superName, "<init>", desc, false));
            ctor.instructions.add(new InsnNode(Opcodes.RETURN));
            node.methods.add(ctor);
            addedCtors++;
        }
    }

    // ---------- الخطوة 3: الإطارات ----------

    /** تسلسل الأصناف لحساب الإطارات بلا تحميل أي صنف (قراءة البايتات فقط): الإضافة ثم مكتبات Suwayomi. */
    private static final class Hierarchy {
        private final Map<String, ClassNode> own;
        private final ClassLoader libraries;
        private final Map<String, String[]> cache = new HashMap<>(); // name → {super, isInterface}

        Hierarchy(Map<String, ClassNode> own, ClassLoader libraries) { this.own = own; this.libraries = libraries; }

        private String[] info(String name) {
            return cache.computeIfAbsent(name, n -> {
                ClassNode node = own.get(n);
                if (node != null) return new String[]{node.superName, String.valueOf((node.access & Opcodes.ACC_INTERFACE) != 0)};
                try (InputStream in = libraries.getResourceAsStream(n + ".class")) {
                    if (in == null) return null;
                    ClassReader reader = new ClassReader(in);
                    return new String[]{reader.getSuperName(), String.valueOf((reader.getAccess() & Opcodes.ACC_INTERFACE) != 0)};
                } catch (Exception e) {
                    return null;
                }
            });
        }

        private List<String> chain(String name) {
            List<String> out = new ArrayList<>();
            for (String at = name; at != null && out.size() < 64; ) {
                out.add(at);
                String[] i = info(at);
                at = i == null ? null : i[0];
            }
            return out;
        }

        String common(String a, String b) {
            if (a.equals(b)) return a;
            String[] ia = info(a), ib = info(b);
            if (ia == null || ib == null || "true".equals(ia[1]) || "true".equals(ib[1])) return OBJECT;
            List<String> ca = chain(a);
            for (String at : chain(b)) if (ca.contains(at)) return at;
            return OBJECT;
        }
    }

    // ---------- الخطوة 4: الحزمة ----------

    private static void writeJar(Path out, Map<String, byte[]> classes, String manifest, byte[] apk) throws Exception {
        Path tmp = out.resolveSibling(out.getFileName() + ".tmp");
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(tmp))) {
            put(zip, "AndroidManifest.xml", manifest.getBytes(StandardCharsets.UTF_8));
            for (Map.Entry<String, byte[]> e : classes.entrySet()) put(zip, e.getKey(), e.getValue());
            try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(apk))) {
                for (ZipEntry e; (e = in.getNextEntry()) != null; ) {
                    String n = e.getName();
                    if (e.isDirectory() || n.contains("..") || n.startsWith("/")) continue;
                    if (n.equals("resources.arsc") || n.startsWith("res/") || n.startsWith("assets/")) put(zip, n, in.readAllBytes());
                }
            }
        }
        // نفس خطوة Suwayomi بعد التحويل: أصناف Java التي تختلف في أندرويد تُحوَّل لبدائلها.
        BytecodeEditor.INSTANCE.fixAndroidClasses(tmp);
        Files.move(tmp, out, StandardCopyOption.REPLACE_EXISTING);
    }

    private static void put(ZipOutputStream zip, String name, byte[] bytes) throws Exception {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(bytes);
        zip.closeEntry();
    }

    private static String json(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }
}
