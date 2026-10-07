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
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * VANTARA Anime Enhance — fused real-time frame pass.
 *
 * لا يوجد تنزيل/تصدير/ملف 1440p. كل frame:
 * decoder -> cleanup/deband -> Anime4K line reconstruction -> upscale -> clarity/sharpen
 * -> anti-ringing -> display.
 *
 * دمجنا المراحل في pass واحد عمدًا لتفادي 2-3 frame buffers ضخمة أثناء التشغيل على الجوال،
 * ولمنع تبديل السيرفر بسبب فشل video-effect graph.
 *
 * Anime4K line-reconstruction polynomial/direction is based on bloc97/Anime4K (MIT).
 * See assets/licenses/Anime4K-MIT.txt.
 */
@UnstableApi
class Anime4kEffect(
    val mode: Mode,
    private val maxWidth: Int = 2560,
    private val maxHeight: Int = 1440,
) : GlEffect {

    enum class Mode(
        val key: String,
        val refine: Float,
        val sharpness: Float,
    ) {
        FAST("fast", 0.48f, 0.14f),
        BALANCED("balanced", 0.70f, 0.34f),
        STRONG("strong", 0.92f, 0.52f);

        companion object {
            fun fromKey(value: String?): Mode = when (value) {
                FAST.key -> FAST
                STRONG.key -> STRONG
                else -> BALANCED
            }
        }
    }

    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        Anime4kShaderProgram(mode, maxWidth, maxHeight, useHdr)

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean = false

    companion object {
        /** 1920x1080 -> 2560x1440. Smaller sources never exceed x2. */
        fun targetSize(
            inputWidth: Int,
            inputHeight: Int,
            maxWidth: Int = 2560,
            maxHeight: Int = 1440,
        ): Pair<Int, Int> {
            if (inputWidth <= 0 || inputHeight <= 0) return inputWidth to inputHeight
            val scale = min(
                2f,
                min(maxWidth.toFloat() / inputWidth, maxHeight.toFloat() / inputHeight),
            )
            if (scale <= 1f) return inputWidth to inputHeight
            val w = ((inputWidth * scale).roundToInt() / 2) * 2
            val h = ((inputHeight * scale).roundToInt() / 2) * 2
            return w.coerceAtLeast(2) to h.coerceAtLeast(2)
        }
    }
}

@UnstableApi
private class Anime4kShaderProgram(
    private val mode: Anime4kEffect.Mode,
    private val maxWidth: Int,
    private val maxHeight: Int,
    useHdr: Boolean,
) : BaseGlShaderProgram(
    /* useHighPrecisionColorComponents = */ useHdr,
    /* texturePoolCapacity = */ 1,
) {
    private val program: GlProgram
    private var inputWidth = 1
    private var inputHeight = 1

    init {
        try {
            program = GlProgram(VERTEX_SHADER, FRAGMENT_SHADER)
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
        val (w, h) = Anime4kEffect.targetSize(inputWidth, inputHeight, maxWidth, maxHeight)
        return Size(w, h)
    }

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            program.use()
            program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            program.setFloatsUniform(
                "uTexel",
                floatArrayOf(1f / inputWidth.toFloat(), 1f / inputHeight.toFloat()),
            )
            program.setFloatUniform("uRefineStrength", mode.refine)
            program.setFloatUniform("uSharpness", mode.sharpness)
            program.setFloatUniform(
                "uCleanup",
                when (mode) {
                    Anime4kEffect.Mode.FAST -> 0.04f
                    Anime4kEffect.Mode.BALANCED -> 0.14f
                    Anime4kEffect.Mode.STRONG -> 0.20f
                },
            )
            program.setFloatUniform(
                "uSaturation",
                when (mode) {
                    Anime4kEffect.Mode.FAST -> 1.01f
                    Anime4kEffect.Mode.BALANCED -> 1.045f
                    Anime4kEffect.Mode.STRONG -> 1.08f
                },
            )
            program.setFloatUniform(
                "uContrast",
                when (mode) {
                    Anime4kEffect.Mode.FAST -> 1.01f
                    Anime4kEffect.Mode.BALANCED -> 1.025f
                    Anime4kEffect.Mode.STRONG -> 1.04f
                },
            )
            program.setFloatUniform(
                "uDither",
                when (mode) {
                    Anime4kEffect.Mode.FAST -> 0.08f
                    Anime4kEffect.Mode.BALANCED -> 0.16f
                    Anime4kEffect.Mode.STRONG -> 0.22f
                },
            )
            program.bindAttributesAndUniforms()
            GLES20.glDisable(GLES20.GL_BLEND)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
        } catch (e: Exception) {
            throw VideoFrameProcessingException(e, presentationTimeUs)
        }
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

        /**
         * One-pass mobile implementation:
         *  - flat-region cleanup/deband
         *  - Anime4K-style Sobel + polynomial line reconstruction
         *  - edge-aware clarity/sharpen
         *  - local anti-ringing clamp
         *  - mild saturation/contrast matching the requested crisp 1440p look
         *
         * The spatial dither is deterministic from pixel coordinates, so it does not flicker.
         */
        private const val FRAGMENT_SHADER = """
            precision highp float;

            uniform sampler2D uTexSampler;
            uniform vec2 uTexel;
            uniform float uRefineStrength;
            uniform float uSharpness;
            uniform float uCleanup;
            uniform float uSaturation;
            uniform float uContrast;
            uniform float uDither;
            varying vec2 vTexCoords;

            const float P5 =  11.68129591;
            const float P4 = -42.46906057;
            const float P3 =  60.28286266;
            const float P2 = -41.84451327;
            const float P1 =  14.05517353;
            const float P0 =  -1.081521930;

            float luma(vec3 rgb) {
                return dot(rgb, vec3(0.299, 0.587, 0.114));
            }

            float refineCurve(float x) {
                float x2 = x * x;
                float x3 = x2 * x;
                float x4 = x2 * x2;
                float x5 = x2 * x3;
                return P5*x5 + P4*x4 + P3*x3 + P2*x2 + P1*x + P0;
            }

            float hash12(vec2 p) {
                vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            void main() {
                vec2 p = vTexCoords;
                vec2 d = uTexel;

                vec4 cc = texture2D(uTexSampler, p);
                vec4 l4 = texture2D(uTexSampler, p + vec2(-d.x, 0.0));
                vec4 r4 = texture2D(uTexSampler, p + vec2( d.x, 0.0));
                vec4 t4 = texture2D(uTexSampler, p + vec2(0.0, -d.y));
                vec4 b4 = texture2D(uTexSampler, p + vec2(0.0,  d.y));
                vec4 tl4 = texture2D(uTexSampler, p + vec2(-d.x, -d.y));
                vec4 tr4 = texture2D(uTexSampler, p + vec2( d.x, -d.y));
                vec4 bl4 = texture2D(uTexSampler, p + vec2(-d.x,  d.y));
                vec4 br4 = texture2D(uTexSampler, p + vec2( d.x,  d.y));

                float yc = luma(cc.rgb);
                float tl = luma(tl4.rgb);
                float tc = luma(t4.rgb);
                float tr = luma(tr4.rgb);
                float ml = luma(l4.rgb);
                float mr = luma(r4.rgb);
                float bl = luma(bl4.rgb);
                float bc = luma(b4.rgb);
                float br = luma(br4.rgb);

                float localMinY = min(yc, min(min(tc, bc), min(ml, mr)));
                float localMaxY = max(yc, max(max(tc, bc), max(ml, mr)));
                float localRange = localMaxY - localMinY;
                float flat = 1.0 - smoothstep(0.018, 0.095, localRange);

                // Very small cleanup only in flat/compressed areas.
                vec3 crossMean = (l4.rgb + r4.rgb + t4.rgb + b4.rgb) * 0.25;
                float similar = 1.0 - smoothstep(0.018, 0.085, abs(luma(crossMean) - yc));
                vec3 base = mix(cc.rgb, crossMean, uCleanup * flat * similar);

                // Anime4K line direction / reconstruction.
                float gx = (-tl + tr) + (-2.0 * ml + 2.0 * mr) + (-bl + br);
                float gy = (-tl - 2.0 * tc - tr) + (bl + 2.0 * bc + br);
                float edge = clamp(length(vec2(gx, gy)) * 0.25, 0.0, 1.0);
                float amount = clamp(refineCurve(edge) * uRefineStrength, 0.0, 1.0);

                vec2 direction = -sign(vec2(gx, gy));
                vec3 xValue = texture2D(uTexSampler, p + vec2(d.x * direction.x, 0.0)).rgb;
                vec3 yValue = texture2D(uTexSampler, p + vec2(0.0, d.y * direction.y)).rgb;
                float denom = abs(gx) + abs(gy) + 0.00001;
                float xRatio = abs(gx) / denom;
                vec3 directed = mix(yValue, xValue, xRatio);
                vec3 result = mix(base, directed, amount);

                // Stronger clarity than the previous build. This is what makes on/off obvious.
                vec3 high = result - crossMean;
                float detailGate = 0.22 + 0.78 * smoothstep(0.010, 0.18, localRange);
                result += high * uSharpness * detailGate;

                // Prevent white/black halos from escaping the local neighborhood.
                vec3 lo = min(cc.rgb, min(min(l4.rgb, r4.rgb), min(t4.rgb, b4.rgb)));
                vec3 hi = max(cc.rgb, max(max(l4.rgb, r4.rgb), max(t4.rgb, b4.rgb)));
                result = clamp(result, lo, hi);

                // Mild crisp-look finishing: preserve hue, only modestly lift saturation/contrast.
                float y = luma(result);
                result = mix(vec3(y), result, uSaturation);
                float y2 = luma(result);
                float yc2 = clamp((y2 - 0.5) * uContrast + 0.5, 0.0, 1.0);
                result += vec3(yc2 - y2);

                // Stable spatial dither in gradients to reduce banding without temporal shimmer.
                float noise = (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
                result += vec3(noise * uDither * flat);

                gl_FragColor = vec4(clamp(result, 0.0, 1.0), cc.a);
            }
        """
    }
}
