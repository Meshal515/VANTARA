package com.vantara.anime.player

import android.content.Context
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.ConvolutionFunction1D
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import androidx.media3.effect.SeparableConvolutionShaderProgram
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sqrt

/**
 * Stable detail restoration implemented on Media3's own separable-convolution renderer.
 *
 * No custom GLSL is used here. Media3 owns the GL program, FBOs and texture lifecycle, which
 * avoids the frame-processing failures seen with VANTARA's hand-written shader path on Adreno.
 *
 * The kernel is a conservative difference-of-Gaussians deconvolution. It restores line/detail
 * energy without a hard unsharp-mask edge, and strength is selected from the *actual* input
 * height reported by Media3 at configure time.
 */
@UnstableApi
class AnimeNativeDetailEffect(
    private val mode: Anime4kEffect.Mode,
    private val stage: Stage,
) : GlEffect {

    enum class Stage { SOURCE_RESTORE, MID_RESTORE, FINAL_POLISH }

    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        SeparableConvolutionShaderProgram(context, useHdr, Provider(mode, stage))

    private class Provider(
        private val mode: Anime4kEffect.Mode,
        private val stage: Stage,
    ) : ConvolutionFunction1D.Provider {
        private var inputHeight: Int = 1080

        override fun configure(inputSize: Size): Size {
            inputHeight = inputSize.height.coerceAtLeast(1)
            return inputSize
        }

        override fun getConvolution(presentationTimeUs: Long): ConvolutionFunction1D {
            val strength = when (stage) {
                Stage.SOURCE_RESTORE -> sourceStrength(inputHeight, mode)
                Stage.MID_RESTORE -> midStrength(inputHeight, mode)
                Stage.FINAL_POLISH -> when (mode) {
                    Anime4kEffect.Mode.FAST -> 0f
                    Anime4kEffect.Mode.BALANCED -> 0.10f
                    Anime4kEffect.Mode.STRONG -> 0.22f
                }
            }
            return DogKernel(
                strength = strength,
                sharpSigma = when (stage) {
                    Stage.SOURCE_RESTORE -> 0.50f
                    Stage.MID_RESTORE -> 0.48f
                    Stage.FINAL_POLISH -> 0.52f
                },
                blurSigma = when (stage) {
                    Stage.SOURCE_RESTORE -> 1.00f
                    Stage.MID_RESTORE -> 0.96f
                    Stage.FINAL_POLISH -> 0.90f
                },
            )
        }

        private fun sourceStrength(height: Int, mode: Anime4kEffect.Mode): Float {
            // Calibrated against the current/desired reference frames. The old 720p value (0.31)
            // only moved ~2% of pixels visibly; this tier reaches a genuinely different image while
            // the broad Gaussian lobe keeps the line response smooth rather than halo-like.
            val strong = when {
                height <= 360 -> 1.70f
                height <= 480 -> 1.48f
                height <= 576 -> 1.34f
                height <= 720 -> 1.18f
                height <= 900 -> 0.78f
                else -> 0.46f
            }
            return when (mode) {
                Anime4kEffect.Mode.FAST -> 0f
                Anime4kEffect.Mode.BALANCED -> strong * 0.58f
                Anime4kEffect.Mode.STRONG -> strong
            }
        }

        private fun midStrength(height: Int, mode: Anime4kEffect.Mode): Float {
            val strong = when {
                height <= 720 -> 0.46f
                height <= 1080 -> 0.34f
                else -> 0.20f
            }
            return when (mode) {
                Anime4kEffect.Mode.FAST -> 0f
                Anime4kEffect.Mode.BALANCED -> strong * 0.55f
                Anime4kEffect.Mode.STRONG -> strong
            }
        }
    }

    /**
     * (1+s)*G(sigmaSharp) - s*G(sigmaBlur).
     * The continuous kernel integrates to ~1, so Media3's weight normalization doesn't alter
     * brightness. Broad negative lobes are deliberately weak to avoid visible ringing/halos.
     */
    private data class DogKernel(
        val strength: Float,
        val sharpSigma: Float,
        val blurSigma: Float,
    ) : ConvolutionFunction1D {
        override fun domainStart(): Float = -2.75f
        override fun domainEnd(): Float = 2.75f

        override fun value(samplePosition: Float): Float {
            if (strength <= 0f) {
                // Very narrow Gaussian behaves as a stable identity through Media3's own shader.
                return gaussian(samplePosition, 0.20f)
            }
            val sharp = gaussian(samplePosition, sharpSigma)
            val blur = gaussian(samplePosition, blurSigma)
            return (1f + strength) * sharp - strength * blur
        }

        private fun gaussian(x: Float, sigma: Float): Float {
            val z = x / sigma
            return (exp((-0.5f * z * z).toDouble()) / (sigma * sqrt(2.0 * PI))).toFloat()
        }
    }
}
