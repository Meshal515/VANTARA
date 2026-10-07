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
 * Anime4K لحظي للمشغّل.
 *
 * لا ينشئ ملفًا ولا يعيد ترميز الحلقة: كل frame يخرج من decoder يمر عبر
 * OpenGL ثم يُعرض مباشرة. الهدف الحالي 2560x1440 كحد أقصى، وبحد أقصى x2
 * لكل بُعد حتى لا نحول المصادر الضعيفة إلى حمل GPU بلا فائدة.
 *
 * خوارزمية إعادة بناء الحواف هنا port صغير ومباشر مبني على
 * Anime4K_Upscale_Original_x2.glsl من bloc97/Anime4K (MIT):
 * Sobel/luma direction + polynomial refinement + edge-directed blend.
 * أُضيف فقط anti-ringing clamp وdetail صغير مضبوط لكل preset.
 *
 * Copyright (c) 2019-2021 bloc97 — MIT.
 * النص الكامل للرخصة في assets/licenses/Anime4K-MIT.txt.
 */
@UnstableApi
class Anime4kEffect(
    val mode: Mode,
    private val maxWidth: Int = 2560,
    private val maxHeight: Int = 1440,
) : GlEffect {

    enum class Mode(val key: String, val refine: Float, val detail: Float) {
        FAST("fast", 0.34f, 0.035f),
        BALANCED("balanced", 0.50f, 0.070f),
        STRONG("strong", 0.72f, 0.105f);

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

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean {
        val (w, h) = targetSize(inputWidth, inputHeight, maxWidth, maxHeight)
        return w <= inputWidth && h <= inputHeight
    }

    companion object {
        /**
         * 1080p 16:9 -> 2560x1440، 720p -> 2560x1440، وأي مصدر أصغر لا يتجاوز x2.
         * يحافظ على aspect ratio ويجعل الأبعاد زوجية لتفادي مشاكل بعض مسارات codec/GL.
         */
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
            program.setFloatUniform("uDetailStrength", mode.detail)
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
         * Single-pass real-time port of Anime4K Original x2's line refinement.
         * The official polynomial and directional blend are retained. Sampling the decoded
         * texture at the output grid gives the resize; refinement then rebuilds line edges.
         */
        private const val FRAGMENT_SHADER = """
            precision highp float;

            uniform sampler2D uTexSampler;
            uniform vec2 uTexel;
            uniform float uRefineStrength;
            uniform float uDetailStrength;
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

                float tl = luma(tl4.rgb);
                float tc = luma(t4.rgb);
                float tr = luma(tr4.rgb);
                float ml = luma(l4.rgb);
                float mr = luma(r4.rgb);
                float bl = luma(bl4.rgb);
                float bc = luma(b4.rgb);
                float br = luma(br4.rgb);

                // Sobel orientation, same role as Anime4K's LUMAD/LUMAMM passes.
                float gx = (-tl + tr) + (-2.0 * ml + 2.0 * mr) + (-bl + br);
                float gy = (-tl - 2.0 * tc - tr) + (bl + 2.0 * bc + br);
                float edge = clamp(length(vec2(gx, gy)) * 0.25, 0.0, 1.0);
                float amount = clamp(refineCurve(edge) * uRefineStrength, 0.0, 1.0);

                vec2 direction = -sign(vec2(gx, gy));
                vec4 xValue = texture2D(uTexSampler, p + vec2(d.x * direction.x, 0.0));
                vec4 yValue = texture2D(uTexSampler, p + vec2(0.0, d.y * direction.y));
                float denom = abs(gx) + abs(gy) + 0.00001;
                float xRatio = abs(gx) / denom;
                vec3 directed = mix(yValue.rgb, xValue.rgb, xRatio);

                vec3 refined = mix(cc.rgb, directed, amount);

                // Small edge-aware detail restoration. Keep it inside the local 5-tap envelope
                // to avoid bright halos/ringing around line art.
                vec3 localBlur = (l4.rgb + r4.rgb + t4.rgb + b4.rgb) * 0.25;
                vec3 detail = (cc.rgb - localBlur) * uDetailStrength * (0.35 + 0.65 * edge);
                vec3 result = refined + detail;

                vec3 lo = min(cc.rgb, min(min(l4.rgb, r4.rgb), min(t4.rgb, b4.rgb)));
                vec3 hi = max(cc.rgb, max(max(l4.rgb, r4.rgb), max(t4.rgb, b4.rgb)));
                result = clamp(result, lo, hi);

                gl_FragColor = vec4(result, cc.a);
            }
        """
    }
}
