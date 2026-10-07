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
 * Pass 1: source-resolution restoration.
 *
 * Removes compression softness/noise in flat regions and restores luma detail before scaling.
 * The work is source-resolution, so aggressive 320-576p cleanup is cheap compared with doing the
 * same work at 1440p. Color is intentionally preserved; most correction is luma-only.
 */
@UnstableApi
class AnimeRestoreEffect(
    private val mode: Anime4kEffect.Mode,
) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        AnimeRestoreProgram(mode, useHdr)
}

@UnstableApi
private class AnimeRestoreProgram(
    private val mode: Anime4kEffect.Mode,
    useHdr: Boolean,
) : BaseGlShaderProgram(
    /* useHighPrecisionColorComponents = */ useHdr,
    /* texturePoolCapacity = */ 1,
) {
    private val program: GlProgram
    private var inputWidth = 1
    private var inputHeight = 1
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
        AnimeEnhanceTelemetry.mark("restore.configure")
        this.inputWidth = inputWidth.coerceAtLeast(1)
        this.inputHeight = inputHeight.coerceAtLeast(1)
        tuning = AnimeQualityTuning.forSourceHeight(this.inputHeight, mode)
        val (outW, outH) = Anime4kEffect.targetSize(this.inputWidth, this.inputHeight)
        AnimeEnhanceTelemetry.configureSource(this.inputWidth, this.inputHeight, outW, outH)
        return Size(this.inputWidth, this.inputHeight)
    }

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            AnimeEnhanceTelemetry.mark("restore.draw")
            AnimeEnhanceTelemetry.beginFrame(presentationTimeUs)

            program.use()
            program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            program.setFloatsUniform(
                "uTexel",
                floatArrayOf(1f / inputWidth.toFloat(), 1f / inputHeight.toFloat()),
            )
            program.setFloatUniform("uCleanup", tuning.cleanup)
            program.setFloatUniform("uDeblur", tuning.deblur)
            program.setFloatUniform("uSecondRing", tuning.secondRing)
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
         * Edge-preserving cleanup + adaptive deblur.
         *
         * The bilateral stage is intentionally limited to flat/compressed regions. High-contrast
         * line art is protected and the deblur runs on luma, so saturation/hue are not pushed.
         */
        private const val FRAGMENT_SHADER = """
            precision highp float;

            uniform sampler2D uTexSampler;
            uniform vec2 uTexel;
            uniform float uCleanup;
            uniform float uDeblur;
            uniform float uSecondRing;
            varying vec2 vTexCoords;

            float luma(vec3 c) {
                return dot(c, vec3(0.299, 0.587, 0.114));
            }

            float wSimilarity(float a, float b, float scale) {
                float d = (a - b) * scale;
                return 1.0 / (1.0 + d * d);
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
                float flat = 1.0 - smoothstep(0.022, 0.115, localRange);

                float gx = (-ytl + ytr) + (-2.0*yl + 2.0*yr) + (-ybl + ybr);
                float gy = (-ytl - 2.0*yt - ytr) + (ybl + 2.0*yb + ybr);
                float edge = clamp(length(vec2(gx, gy)) * 0.30, 0.0, 1.0);

                // Noise/compression estimate: incoherent high-frequency changes should be cleaned,
                // while coherent Sobel edges should be retained.
                float activity =
                    abs(yc-yl) + abs(yc-yr) + abs(yc-yt) + abs(yc-yb) +
                    0.5*(abs(yc-ytl)+abs(yc-ytr)+abs(yc-ybl)+abs(yc-ybr));
                float coherence = clamp(edge / (activity * 0.48 + 0.018), 0.0, 1.0);
                float artifact = clamp((activity * 1.35 - edge) * 2.6, 0.0, 1.0);

                float wl = wSimilarity(yl, yc, 19.0);
                float wr = wSimilarity(yr, yc, 19.0);
                float wt = wSimilarity(yt, yc, 19.0);
                float wb = wSimilarity(yb, yc, 19.0);
                float wtl = 0.72 * wSimilarity(ytl, yc, 18.0);
                float wtr = 0.72 * wSimilarity(ytr, yc, 18.0);
                float wbl = 0.72 * wSimilarity(ybl, yc, 18.0);
                float wbr = 0.72 * wSimilarity(ybr, yc, 18.0);
                float sumW = 1.45 + wl+wr+wt+wb+wtl+wtr+wbl+wbr;
                vec3 bilateral =
                    (c*1.45 + l*wl + r*wr + t*wt + b*wb +
                     tl*wtl + tr*wtr + bl*wbl + br*wbr) / sumW;

                float cleanGate = uCleanup * clamp(flat*0.82 + artifact*0.62, 0.0, 1.0) * (1.0 - 0.72*coherence);
                vec3 restored = mix(c, bilateral, cleanGate);

                // Multi-radius luma restoration: near blur handles small softness, second ring
                // restores lines that were downsampled heavily in 320-576p sources.
                float nearBlurY = (yl + yr + yt + yb) * 0.25;
                float wideBlurY = (luma(l2)+luma(r2)+luma(t2)+luma(b2)) * 0.25;
                float blurY = mix(nearBlurY, wideBlurY, 0.32 * uSecondRing);
                float high = yc - blurY;

                float restoreGate =
                    (1.0 - flat*0.72) *
                    (0.25 + 0.75*coherence) *
                    (1.0 - artifact*0.58);
                float lift = high * uDeblur * restoreGate;
                restored += vec3(lift);

                // Never let source-resolution restoration create a halo outside the 2px envelope.
                float wideMinY = min(minY, min(min(luma(l2), luma(r2)), min(luma(t2), luma(b2))));
                float wideMaxY = max(maxY, max(max(luma(l2), luma(r2)), max(luma(t2), luma(b2))));
                float outY = luma(restored);
                float clampedY = clamp(outY, wideMinY - 0.006, wideMaxY + 0.006);
                restored += vec3(clampedY - outY);

                gl_FragColor = vec4(clamp(restored, 0.0, 1.0), c4.a);
            }
        """
    }
}
