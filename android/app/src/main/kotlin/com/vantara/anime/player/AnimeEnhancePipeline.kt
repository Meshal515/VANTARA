package com.vantara.anime.player

import android.content.Context
import android.opengl.GLES20
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram

/**
 * مراحل تحسين الصورة العامة للأنمي قبل/بعد Anime4K.
 *
 * الهدف هنا ليس تغيير ألوان العمل أو صنع HDR وهمي. المعالجة موجهة إلى:
 * - آثار الضغط والـmosquito noise في المناطق الهادئة.
 * - banding الخفيف مع dithering ثابت مكانيًا (لا يرفرف بين الفريمات).
 * - استعادة blur/detail على الـluma بدون دفع الألوان إلى saturation مزيف.
 * - anti-aliasing خفيف بعد الرفع، مع anti-ringing clamp.
 *
 * كل مرحلة GlEffect حية داخل Media3، لذلك لا يوجد export أو ملف وسيط:
 * decoder -> cleanup/restore -> Anime4K upscale -> finish -> display.
 *
 * الـbilateral weighting مبني على Anime4K_Denoise_Bilateral_Mean.glsl
 * من bloc97/Anime4K (MIT). راجع assets/licenses/Anime4K-MIT.txt.
 */
@UnstableApi
object AnimeEnhancePipeline {
    fun effects(mode: Anime4kEffect.Mode): List<GlEffect> = when (mode) {
        Anime4kEffect.Mode.FAST -> listOf(
            Anime4kEffect(mode),
            AnimeFinishEffect(mode),
        )
        Anime4kEffect.Mode.BALANCED,
        Anime4kEffect.Mode.STRONG -> listOf(
            AnimeCleanRestoreEffect(mode),
            Anime4kEffect(mode),
            AnimeFinishEffect(mode),
        )
    }

    fun description(mode: Anime4kEffect.Mode): String = when (mode) {
        Anime4kEffect.Mode.FAST -> "رفع + تنعيم حواف"
        Anime4kEffect.Mode.BALANCED -> "تنظيف + Deband + Restore + رفع + Anti-alias"
        Anime4kEffect.Mode.STRONG -> "تنظيف قوي + Deband + Deblur + Restore + رفع + Anti-alias"
    }
}

@UnstableApi
private class AnimeCleanRestoreEffect(
    private val mode: Anime4kEffect.Mode,
) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        AnimeCleanRestoreProgram(mode, useHdr)
}

@UnstableApi
private class AnimeFinishEffect(
    private val mode: Anime4kEffect.Mode,
) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        AnimeFinishProgram(mode, useHdr)
}

@UnstableApi
private abstract class AnimePassProgram(
    useHdr: Boolean,
    fragmentShader: String,
) : BaseGlShaderProgram(
    /* useHighPrecisionColorComponents = */ useHdr,
    /* texturePoolCapacity = */ 1,
) {
    protected val program: GlProgram
    protected var inputWidth = 1
    protected var inputHeight = 1

    init {
        try {
            program = GlProgram(VERTEX_SHADER, fragmentShader)
            program.setBufferAttribute(
                "aFramePosition",
                GlUtil.getNormalizedCoordinateBounds(),
                GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE,
            )
            program.setBufferAttribute(
                "aTexCoords",
                GlUtil.getTextureCoordinateBounds(),
                GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE,
            )
        } catch (e: Exception) {
            throw VideoFrameProcessingException(e)
        }
    }

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
        this.inputWidth = inputWidth.coerceAtLeast(1)
        this.inputHeight = inputHeight.coerceAtLeast(1)
        return Size(inputWidth, inputHeight)
    }

    protected fun common(inputTexId: Int) {
        program.use()
        program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
        program.setFloatsUniform(
            "uTexel",
            floatArrayOf(1f / inputWidth.toFloat(), 1f / inputHeight.toFloat()),
        )
    }

    override fun release() {
        try {
            program.delete()
        } catch (e: Exception) {
            throw VideoFrameProcessingException(e)
        } finally {
            super.release()
        }
    }

    companion object {
        private const val VERTEX_SHADER = """
            attribute vec4 aFramePosition;
            attribute vec4 aTexCoords;
            varying vec2 vTexCoords;

            void main() {
                gl_Position = aFramePosition;
                vTexCoords = aTexCoords.xy;
            }
        """
    }
}

@UnstableApi
private class AnimeCleanRestoreProgram(
    private val mode: Anime4kEffect.Mode,
    useHdr: Boolean,
) : AnimePassProgram(useHdr, FRAGMENT_SHADER) {

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            common(inputTexId)
            val cleanup = when (mode) {
                Anime4kEffect.Mode.FAST -> 0.0f
                Anime4kEffect.Mode.BALANCED -> 0.32f
                Anime4kEffect.Mode.STRONG -> 0.48f
            }
            val deblur = when (mode) {
                Anime4kEffect.Mode.FAST -> 0.0f
                Anime4kEffect.Mode.BALANCED -> 0.16f
                Anime4kEffect.Mode.STRONG -> 0.26f
            }
            val dither = when (mode) {
                Anime4kEffect.Mode.FAST -> 0.0f
                Anime4kEffect.Mode.BALANCED -> 0.34f
                Anime4kEffect.Mode.STRONG -> 0.50f
            }
            program.setFloatUniform("uCleanup", cleanup)
            program.setFloatUniform("uDeblur", deblur)
            program.setFloatUniform("uDither", dither)
            program.bindAttributesAndUniforms()
            GLES20.glDisable(GLES20.GL_BLEND)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
        } catch (e: Exception) {
            throw VideoFrameProcessingException(e, presentationTimeUs)
        }
    }

    companion object {
        /**
         * 3x3 bilateral cleanup + flat-region deband + luma-only detail recovery.
         * The bilateral core follows Anime4K's bilateral-mean idea, but the pass is fused so
         * the S23 does not pay for separate denoise/deband/deblur frame buffers.
         */
        private const val FRAGMENT_SHADER = """
            precision highp float;

            uniform sampler2D uTexSampler;
            uniform vec2 uTexel;
            uniform float uCleanup;
            uniform float uDeblur;
            uniform float uDither;
            varying vec2 vTexCoords;

            float luma(vec3 c) {
                return dot(c, vec3(0.299, 0.587, 0.114));
            }

            float hash12(vec2 p) {
                vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            float bilateralWeight(vec3 sampleRgb, vec3 centerRgb, vec2 offset) {
                // Anime4K bilateral-mean principle: spatial Gaussian * intensity Gaussian.
                float spatial = exp(-0.5 * dot(offset, offset));
                float centerY = max(luma(centerRgb), 0.035);
                float sigma = 0.045 + centerY * 0.055;
                float delta = (luma(sampleRgb) - luma(centerRgb)) / sigma;
                float intensity = exp(-0.5 * delta * delta);
                return spatial * intensity;
            }

            void main() {
                vec2 p = vTexCoords;
                vec2 d = uTexel;
                vec4 c4 = texture2D(uTexSampler, p);
                vec3 c = c4.rgb;

                vec3 s00 = texture2D(uTexSampler, p + d * vec2(-1.0, -1.0)).rgb;
                vec3 s10 = texture2D(uTexSampler, p + d * vec2( 0.0, -1.0)).rgb;
                vec3 s20 = texture2D(uTexSampler, p + d * vec2( 1.0, -1.0)).rgb;
                vec3 s01 = texture2D(uTexSampler, p + d * vec2(-1.0,  0.0)).rgb;
                vec3 s21 = texture2D(uTexSampler, p + d * vec2( 1.0,  0.0)).rgb;
                vec3 s02 = texture2D(uTexSampler, p + d * vec2(-1.0,  1.0)).rgb;
                vec3 s12 = texture2D(uTexSampler, p + d * vec2( 0.0,  1.0)).rgb;
                vec3 s22 = texture2D(uTexSampler, p + d * vec2( 1.0,  1.0)).rgb;

                float wc = 1.0;
                vec3 sum = c * wc;
                float weight = wc;

                float w00 = bilateralWeight(s00, c, vec2(-1.0, -1.0)); sum += s00 * w00; weight += w00;
                float w10 = bilateralWeight(s10, c, vec2( 0.0, -1.0)); sum += s10 * w10; weight += w10;
                float w20 = bilateralWeight(s20, c, vec2( 1.0, -1.0)); sum += s20 * w20; weight += w20;
                float w01 = bilateralWeight(s01, c, vec2(-1.0,  0.0)); sum += s01 * w01; weight += w01;
                float w21 = bilateralWeight(s21, c, vec2( 1.0,  0.0)); sum += s21 * w21; weight += w21;
                float w02 = bilateralWeight(s02, c, vec2(-1.0,  1.0)); sum += s02 * w02; weight += w02;
                float w12 = bilateralWeight(s12, c, vec2( 0.0,  1.0)); sum += s12 * w12; weight += w12;
                float w22 = bilateralWeight(s22, c, vec2( 1.0,  1.0)); sum += s22 * w22; weight += w22;

                vec3 bilateral = sum / max(weight, 0.0001);

                float y = luma(c);
                float minY = min(y, min(min(luma(s10), luma(s12)), min(luma(s01), luma(s21))));
                float maxY = max(y, max(max(luma(s10), luma(s12)), max(luma(s01), luma(s21))));
                float localRange = maxY - minY;

                // Clean mostly flat / compressed regions. Line art is protected by the range gate.
                float flat = 1.0 - smoothstep(0.018, 0.095, localRange);
                vec3 cleaned = mix(c, bilateral, uCleanup * flat);

                // Luma-only deblur/detail restore avoids fake saturation/color ringing.
                vec3 crossBlur = (s10 + s12 + s01 + s21) * 0.25;
                float detailY = luma(cleaned) - luma(crossBlur);
                float edgeGate = smoothstep(0.012, 0.14, localRange);
                vec3 restored = cleaned + vec3(detailY * uDeblur * (0.35 + 0.65 * edgeGate));

                // Local anti-ringing clamp: don't create values outside the neighborhood envelope.
                vec3 lo = min(c, min(min(s10, s12), min(s01, s21)));
                vec3 hi = max(c, max(max(s10, s12), max(s01, s21)));
                restored = clamp(restored, lo, hi);

                // Stable spatial dither only in very flat gradients: reduces visible bands without
                // per-frame random noise/flicker.
                float noise = (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
                restored += vec3(noise * uDither * flat);

                gl_FragColor = vec4(clamp(restored, 0.0, 1.0), c4.a);
            }
        """
    }
}

@UnstableApi
private class AnimeFinishProgram(
    private val mode: Anime4kEffect.Mode,
    useHdr: Boolean,
) : AnimePassProgram(useHdr, FRAGMENT_SHADER) {

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            common(inputTexId)
            val aa = when (mode) {
                Anime4kEffect.Mode.FAST -> 0.10f
                Anime4kEffect.Mode.BALANCED -> 0.15f
                Anime4kEffect.Mode.STRONG -> 0.20f
            }
            val detail = when (mode) {
                Anime4kEffect.Mode.FAST -> 0.025f
                Anime4kEffect.Mode.BALANCED -> 0.045f
                Anime4kEffect.Mode.STRONG -> 0.065f
            }
            program.setFloatUniform("uAaStrength", aa)
            program.setFloatUniform("uDetail", detail)
            program.bindAttributesAndUniforms()
            GLES20.glDisable(GLES20.GL_BLEND)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
        } catch (e: Exception) {
            throw VideoFrameProcessingException(e, presentationTimeUs)
        }
    }

    companion object {
        /**
         * Post-upscale line polish: tangent AA reduces staircase edges while detail is restored
         * locally. A cross-neighborhood clamp prevents halos around subtitles/line art.
         */
        private const val FRAGMENT_SHADER = """
            precision highp float;

            uniform sampler2D uTexSampler;
            uniform vec2 uTexel;
            uniform float uAaStrength;
            uniform float uDetail;
            varying vec2 vTexCoords;

            float luma(vec3 c) {
                return dot(c, vec3(0.299, 0.587, 0.114));
            }

            void main() {
                vec2 p = vTexCoords;
                vec2 d = uTexel;

                vec4 c4 = texture2D(uTexSampler, p);
                vec3 c = c4.rgb;
                vec3 l = texture2D(uTexSampler, p + vec2(-d.x, 0.0)).rgb;
                vec3 r = texture2D(uTexSampler, p + vec2( d.x, 0.0)).rgb;
                vec3 t = texture2D(uTexSampler, p + vec2(0.0, -d.y)).rgb;
                vec3 b = texture2D(uTexSampler, p + vec2(0.0,  d.y)).rgb;

                float gx = luma(r) - luma(l);
                float gy = luma(b) - luma(t);
                float g = length(vec2(gx, gy));
                float edge = smoothstep(0.025, 0.22, g);

                // Smooth along the edge tangent, not across the line.
                vec2 tangent = normalize(vec2(-gy, gx) + vec2(0.00001));
                vec2 tap = tangent * d * 0.72;
                vec3 ta = texture2D(uTexSampler, p + tap).rgb;
                vec3 tb = texture2D(uTexSampler, p - tap).rgb;
                vec3 aa = (ta + tb) * 0.5;
                vec3 polished = mix(c, aa, edge * uAaStrength);

                vec3 blur = (l + r + t + b) * 0.25;
                float detailY = luma(c) - luma(blur);
                polished += vec3(detailY * uDetail);

                vec3 lo = min(c, min(min(l, r), min(t, b)));
                vec3 hi = max(c, max(max(l, r), max(t, b)));
                polished = clamp(polished, lo, hi);

                gl_FragColor = vec4(clamp(polished, 0.0, 1.0), c4.a);
            }
        """
    }
}
