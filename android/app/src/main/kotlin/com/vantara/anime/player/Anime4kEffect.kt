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
 * Pass 2: resolution-aware Anime4K-style reconstruction + upscale to the final 1440p surface.
 *
 * This is deliberately not "turn sharpen up". It separates coherent line edges from noise,
 * reconstructs along the edge tangent, applies scale-aware anti-aliasing, restores luma detail,
 * and clamps every result to a local envelope to prevent halos/ringing.
 *
 * The first pass (AnimeRestoreEffect) works at source resolution; this pass spends the expensive
 * work only once while producing 1440p. 320/360p therefore get a much more aggressive profile
 * than native 1080p.
 *
 * Concepts are based on Anime4K's real-time line-reconstruction approach (bloc97/Anime4K, MIT).
 * See assets/licenses/Anime4K-MIT.txt.
 */
@UnstableApi
class Anime4kEffect(
    val mode: Mode,
    private val stage: Stage = Stage.FINAL,
    private val maxWidth: Int = 2560,
    private val maxHeight: Int = 1440,
) : GlEffect {

    enum class Stage { PRIMARY, FINAL }

    enum class Mode(val key: String) {
        FAST("fast"),
        BALANCED("balanced"),
        STRONG("strong");

        companion object {
            fun fromKey(value: String?): Mode = when (value) {
                FAST.key -> FAST
                STRONG.key -> STRONG
                else -> BALANCED
            }
        }
    }

    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        Anime4kShaderProgram(mode, stage, maxWidth, maxHeight, useHdr)

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean {
        if (stage != Stage.FINAL) return false
        val (w, h) = targetSize(inputWidth, inputHeight, maxWidth, maxHeight)
        return w == inputWidth && h == inputHeight
    }

    companion object {
        /** Fit every supported source into the S23 Ultra's 2560x1440 target, preserving aspect. */
        fun targetSize(
            inputWidth: Int,
            inputHeight: Int,
            maxWidth: Int = 2560,
            maxHeight: Int = 1440,
        ): Pair<Int, Int> {
            if (inputWidth <= 0 || inputHeight <= 0) return inputWidth to inputHeight
            val scale = min(
                maxWidth.toFloat() / inputWidth.toFloat(),
                maxHeight.toFloat() / inputHeight.toFloat(),
            )
            val w = (((inputWidth * scale).roundToInt().coerceAtMost(maxWidth)) / 2) * 2
            val h = (((inputHeight * scale).roundToInt().coerceAtMost(maxHeight)) / 2) * 2
            return w.coerceAtLeast(2) to h.coerceAtLeast(2)
        }

        /** First low-resolution stage: never jumps more than 2x in one reconstruction pass. */
        fun primaryTargetSize(
            inputWidth: Int,
            inputHeight: Int,
            maxWidth: Int = 2560,
            maxHeight: Int = 1440,
        ): Pair<Int, Int> {
            if (inputWidth <= 0 || inputHeight <= 0) return inputWidth to inputHeight
            val finalScale = min(
                maxWidth.toFloat() / inputWidth.toFloat(),
                maxHeight.toFloat() / inputHeight.toFloat(),
            )
            val scale = min(2f, finalScale)
            val w = (((inputWidth * scale).roundToInt().coerceAtMost(maxWidth)) / 2) * 2
            val h = (((inputHeight * scale).roundToInt().coerceAtMost(maxHeight)) / 2) * 2
            return w.coerceAtLeast(2) to h.coerceAtLeast(2)
        }
    }
}

@UnstableApi
private class Anime4kShaderProgram(
    private val mode: Anime4kEffect.Mode,
    private val stage: Anime4kEffect.Stage,
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
    private var outputWidth = 1
    private var outputHeight = 1
    private var tuning = AnimeQualityTuning.forSourceHeight(1080, mode)

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
        val base = AnimeQualityTuning.forSourceHeight(this.inputHeight, mode)
        tuning = if (stage == Anime4kEffect.Stage.FINAL) {
            // A second low-res scale stage should refine, not sharpen the already reconstructed
            // intermediate image a second time.
            base.copy(
                cleanup = base.cleanup * 0.45f,
                deblur = base.deblur * 0.48f,
                lineRestore = base.lineRestore * 0.58f,
                antiAlias = base.antiAlias * 0.62f,
                detail = base.detail * 0.38f,
                dither = base.dither * 0.70f,
                secondRing = base.secondRing * 0.48f,
            )
        } else base

        val (w, h) = if (stage == Anime4kEffect.Stage.PRIMARY) {
            Anime4kEffect.primaryTargetSize(this.inputWidth, this.inputHeight, maxWidth, maxHeight)
        } else {
            Anime4kEffect.targetSize(this.inputWidth, this.inputHeight, maxWidth, maxHeight)
        }
        outputWidth = w
        outputHeight = h
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
            program.setFloatUniform("uScale", outputHeight.toFloat() / inputHeight.toFloat())
            program.setFloatUniform("uLineRestore", tuning.lineRestore)
            program.setFloatUniform("uAntiAlias", tuning.antiAlias)
            program.setFloatUniform("uDetail", tuning.detail)
            program.setFloatUniform("uDither", tuning.dither)
            program.setFloatUniform("uSecondRing", tuning.secondRing)
            program.bindAttributesAndUniforms()

            GLES20.glDisable(GLES20.GL_BLEND)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()

            if (stage == Anime4kEffect.Stage.FINAL || outputHeight >= maxHeight) {
                AnimeEnhanceTelemetry.endFrame(presentationTimeUs)
            }
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
         * Scale-aware edge-directed reconstruction.
         *
         * Important properties:
         * - line/tangent processing is separated from texture detail;
         * - flat gradients are excluded from sharpening;
         * - incoherent compression/noise lowers the detail gate;
         * - line darkening is tiny and only applies to coherent dark line art;
         * - local 2px envelopes stop bright/dark halos from escaping the source neighborhood.
         */
        private const val FRAGMENT_SHADER = """
            precision highp float;

            uniform sampler2D uTexSampler;
            uniform vec2 uTexel;
            uniform float uScale;
            uniform float uLineRestore;
            uniform float uAntiAlias;
            uniform float uDetail;
            uniform float uDither;
            uniform float uSecondRing;
            varying vec2 vTexCoords;

            float luma(vec3 c) {
                return dot(c, vec3(0.299, 0.587, 0.114));
            }

            float hash12(vec2 p) {
                vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }

            void main() {
                vec2 p = vTexCoords;
                vec2 d = uTexel;

                vec4 c4 = texture2D(uTexSampler, p);
                vec3 c = c4.rgb;

                vec3 l  = texture2D(uTexSampler, p + vec2(-d.x, 0.0)).rgb;
                vec3 r  = texture2D(uTexSampler, p + vec2( d.x, 0.0)).rgb;
                vec3 t  = texture2D(uTexSampler, p + vec2(0.0, -d.y)).rgb;
                vec3 b  = texture2D(uTexSampler, p + vec2(0.0,  d.y)).rgb;
                vec3 tl = texture2D(uTexSampler, p + vec2(-d.x, -d.y)).rgb;
                vec3 tr = texture2D(uTexSampler, p + vec2( d.x, -d.y)).rgb;
                vec3 bl = texture2D(uTexSampler, p + vec2(-d.x,  d.y)).rgb;
                vec3 br = texture2D(uTexSampler, p + vec2( d.x,  d.y)).rgb;

                vec3 l2 = texture2D(uTexSampler, p + vec2(-2.0*d.x, 0.0)).rgb;
                vec3 r2 = texture2D(uTexSampler, p + vec2( 2.0*d.x, 0.0)).rgb;
                vec3 t2 = texture2D(uTexSampler, p + vec2(0.0, -2.0*d.y)).rgb;
                vec3 b2 = texture2D(uTexSampler, p + vec2(0.0,  2.0*d.y)).rgb;

                float yc = luma(c);
                float yl = luma(l);
                float yr = luma(r);
                float yt = luma(t);
                float yb = luma(b);
                float ytl = luma(tl);
                float ytr = luma(tr);
                float ybl = luma(bl);
                float ybr = luma(br);

                float minY = min(yc, min(min(yl, yr), min(yt, yb)));
                float maxY = max(yc, max(max(yl, yr), max(yt, yb)));
                float localRange = maxY - minY;
                float flat = 1.0 - smoothstep(0.018, 0.105, localRange);

                // Coherent edge orientation.
                float gx = (-ytl + ytr) + (-2.0*yl + 2.0*yr) + (-ybl + ybr);
                float gy = (-ytl - 2.0*yt - ytr) + (ybl + 2.0*yb + ybr);
                float edgeMag = length(vec2(gx, gy));
                float edge = clamp(edgeMag * 0.32, 0.0, 1.0);

                float activity =
                    abs(yc-yl)+abs(yc-yr)+abs(yc-yt)+abs(yc-yb) +
                    0.45*(abs(yc-ytl)+abs(yc-ytr)+abs(yc-ybl)+abs(yc-ybr));
                float coherence = clamp(edgeMag / (activity * 0.56 + 0.020), 0.0, 1.0);
                float artifact = clamp((activity * 1.30 - edgeMag) * 2.3, 0.0, 1.0);

                vec2 normal = normalize(vec2(gx, gy) + vec2(0.000001));
                vec2 tangent = vec2(-normal.y, normal.x);
                vec2 tStep = tangent * d;
                vec2 nStep = normal * d;

                // Sample along the line direction. This attacks stair-steps without averaging
                // across the edge, which is the main reason it stays crisp without halos.
                vec3 ta = texture2D(uTexSampler, p + tStep * 0.55).rgb;
                vec3 tb = texture2D(uTexSampler, p - tStep * 0.55).rgb;
                vec3 ta2 = texture2D(uTexSampler, p + tStep * 1.15).rgb;
                vec3 tb2 = texture2D(uTexSampler, p - tStep * 1.15).rgb;
                vec3 tangentNear = (ta + tb) * 0.5;
                vec3 tangentWide = (ta2 + tb2) * 0.5;

                vec3 na = texture2D(uTexSampler, p + nStep * 0.68).rgb;
                vec3 nb = texture2D(uTexSampler, p - nStep * 0.68).rgb;
                vec3 across = (na + nb) * 0.5;

                // Scale-aware AA: 320/360p need much more reconstruction than 1080p->1440.
                float scaleNeed = clamp((uScale - 1.0) / 3.5, 0.0, 1.0);
                float aliasGate = edge * coherence * (0.32 + 0.68*scaleNeed);
                vec3 edgeAligned = mix(tangentNear, tangentWide, 0.34*uSecondRing);
                vec3 result = mix(c, edgeAligned, uAntiAlias * aliasGate);

                // Line reconstruction: favor the tangent solution only when the local structure is
                // coherent. In noisy/compressed texture the original restored sample wins.
                float reconstructGate =
                    uLineRestore *
                    edge *
                    coherence *
                    (1.0 - 0.72*artifact) *
                    (0.58 + 0.42*scaleNeed);
                result = mix(result, mix(result, edgeAligned, 0.72), reconstructGate);

                // Restore fine luma detail with a multi-radius high-pass. This is contrast-adaptive,
                // not a global sharpen. Gradients and noise are strongly suppressed.
                float nearBlurY = (yl + yr + yt + yb) * 0.25;
                float wideBlurY = (luma(l2)+luma(r2)+luma(t2)+luma(b2)) * 0.25;
                float blurY = mix(nearBlurY, wideBlurY, 0.38*uSecondRing);
                float high = yc - blurY;
                float detailGate =
                    uDetail *
                    (1.0 - flat*0.90) *
                    (0.20 + 0.80*coherence) *
                    (1.0 - artifact*0.78);
                float targetY = luma(result) + high * detailGate;

                // Tiny perceptual line recovery. Only dark coherent lines are affected; highlights
                // and textured areas are left alone.
                float acrossY = luma(across);
                float darkLine = max(acrossY - yc, 0.0);
                targetY -= darkLine * 0.13 * uLineRestore * edge * coherence;

                // Anti-ringing envelope over both 1px and 2px neighbors.
                float wideMinY = min(minY, min(min(luma(l2), luma(r2)), min(luma(t2), luma(b2))));
                float wideMaxY = max(maxY, max(max(luma(l2), luma(r2)), max(luma(t2), luma(b2))));
                float margin = 0.004 + 0.008 * edge * coherence;
                targetY = clamp(targetY, wideMinY - margin, wideMaxY + margin);

                // Apply luminance correction without changing hue/saturation.
                float currentY = luma(result);
                result += vec3(targetY - currentY);

                // Stable dither only on genuinely flat gradients. It hides banding without temporal
                // shimmer and without raising compression noise around line art.
                float noise = (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
                result += vec3(noise * uDither * flat * (1.0 - artifact));

                gl_FragColor = vec4(clamp(result, 0.0, 1.0), c4.a);
            }
        """
    }
}
