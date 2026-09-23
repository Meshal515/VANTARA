package dev.vantara.spike

import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal data class DilarEnvelope(
    val version: Int,
    val epoch: Long,
    val ephemeralPublicKey: ByteArray,
    val iv: ByteArray,
    val ciphertext: ByteArray,
    val tag: ByteArray,
)

internal object DilarCryptoCompat {
    private const val LABEL_V12 = "dilar.response.ecies.v12"

    fun generateClientKeyPair(): KeyPair =
        KeyPairGenerator.getInstance("EC").apply {
            initialize(ECGenParameterSpec("secp256r1"))
        }.generateKeyPair()

    fun publicRaw(publicKey: PublicKey): ByteArray {
        val ec = publicKey as ECPublicKey
        return byteArrayOf(0x04) +
            fixed32(ec.w.affineX) +
            fixed32(ec.w.affineY)
    }

    fun decrypt(
        envelope: DilarEnvelope,
        clientKeyPair: KeyPair,
    ): ByteArray {
        require(envelope.version in 10..12) {
            "Unsupported Dilar compatibility protocol: ${envelope.version}"
        }

        val clientRaw = publicRaw(clientKeyPair.public)
        val serverRaw = envelope.ephemeralPublicKey
        val serverPublic = importRawP256(serverRaw, clientKeyPair.public as ECPublicKey)
        val shared = KeyAgreement.getInstance("ECDH").run {
            init(clientKeyPair.private)
            doPhase(serverPublic, true)
            generateSecret()
        }

        val (hash, salt, info, derivedNonce, aad) = when (envelope.version) {
            10 -> {
                val salt = digest(
                    "SHA-512",
                    concat(
                        u16(clientRaw.size), clientRaw,
                        u16(serverRaw.size), serverRaw,
                        u16(envelope.iv.size), envelope.iv,
                    ),
                )
                val ivDigest = digest("SHA-512", envelope.iv)
                CryptoPlan(
                    hash = "SHA-512",
                    salt = salt,
                    info = "dilar.response.ecies.v10|${envelope.epoch}|${hex(ivDigest).take(24)}".toByteArray(),
                    derivedNonce = false,
                    aad = null,
                )
            }
            11 -> {
                val saltData = concat(
                    u16(envelope.iv.size), envelope.iv,
                    u16(clientRaw.size), clientRaw,
                )
                val salt = hmac("HmacSHA512", serverRaw, saltData)
                val ivDigest = digest("SHA-384", envelope.iv)
                CryptoPlan(
                    hash = "SHA-512",
                    salt = salt,
                    info = "dilar.response.ecies.v11|${envelope.epoch}|${base64Url(ivDigest).take(22)}".toByteArray(),
                    derivedNonce = true,
                    aad = null,
                )
            }
            else -> {
                val saltMac = hmac(
                    "HmacSHA512",
                    clientRaw,
                    concat(
                        u16(serverRaw.size), serverRaw,
                        u16(envelope.iv.size), envelope.iv,
                    ),
                )
                val ivDigest = digest(
                    "SHA-256",
                    concat(u16(envelope.iv.size), envelope.iv),
                )
                val versionBytes = envelope.version.toString().toByteArray()
                val epochBytes = envelope.epoch.toString().toByteArray()
                val label = LABEL_V12.toByteArray()
                val ciphertextLength = u32(envelope.ciphertext.size)
                val aad = digest(
                    "SHA-256",
                    concat(
                        u16(label.size), label,
                        u16(versionBytes.size), versionBytes,
                        u16(epochBytes.size), epochBytes,
                        u16(serverRaw.size), serverRaw,
                        u16(envelope.iv.size), envelope.iv,
                        u16(ciphertextLength.size), ciphertextLength,
                    ),
                )
                CryptoPlan(
                    hash = "SHA-384",
                    salt = saltMac.copyOf(32),
                    info = "dilar.response.ecies.v12|${envelope.epoch}|${base64Url(ivDigest).take(22)}".toByteArray(),
                    derivedNonce = true,
                    aad = aad,
                )
            }
        }

        val materialLength = if (derivedNonce) 44 else 32
        val material = hkdf(hash, shared, salt, info, materialLength)
        val key = material.copyOfRange(0, 32)
        val nonce = if (derivedNonce) material.copyOfRange(32, 44) else envelope.iv

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(128, nonce),
        )
        aad?.let(cipher::updateAAD)
        return cipher.doFinal(envelope.ciphertext + envelope.tag)
    }

    private data class CryptoPlan(
        val hash: String,
        val salt: ByteArray,
        val info: ByteArray,
        val derivedNonce: Boolean,
        val aad: ByteArray?,
    )

    private fun importRawP256(raw: ByteArray, template: ECPublicKey): PublicKey {
        require(raw.size == 65 && raw[0] == 0x04.toByte()) { "invalid P-256 uncompressed key" }
        val x = BigInteger(1, raw.copyOfRange(1, 33))
        val y = BigInteger(1, raw.copyOfRange(33, 65))
        return KeyFactory.getInstance("EC").generatePublic(
            ECPublicKeySpec(ECPoint(x, y), template.params),
        )
    }

    private fun fixed32(value: BigInteger): ByteArray {
        val raw = value.toByteArray()
        return when {
            raw.size == 32 -> raw
            raw.size > 32 -> raw.copyOfRange(raw.size - 32, raw.size)
            else -> ByteArray(32 - raw.size) + raw
        }
    }

    private fun hkdf(
        hash: String,
        ikm: ByteArray,
        salt: ByteArray,
        info: ByteArray,
        length: Int,
    ): ByteArray {
        val macName = when (hash) {
            "SHA-256" -> "HmacSHA256"
            "SHA-384" -> "HmacSHA384"
            "SHA-512" -> "HmacSHA512"
            else -> error("unsupported HKDF hash $hash")
        }
        val prk = hmac(macName, salt, ikm)
        val result = ArrayList<Byte>()
        var previous = ByteArray(0)
        var counter = 1
        while (result.size < length) {
            previous = hmac(macName, prk, previous + info + byteArrayOf(counter.toByte()))
            previous.forEach { result += it }
            counter += 1
        }
        return result.take(length).toByteArray()
    }

    private fun digest(name: String, bytes: ByteArray): ByteArray =
        MessageDigest.getInstance(name).digest(bytes)

    private fun hmac(name: String, key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance(name).run {
            init(SecretKeySpec(key, name))
            doFinal(data)
        }

    private fun u16(value: Int): ByteArray =
        byteArrayOf(((value ushr 8) and 0xff).toByte(), (value and 0xff).toByte())

    private fun u32(value: Int): ByteArray =
        ByteBuffer.allocate(4).putInt(value).array()

    private fun concat(vararg parts: ByteArray): ByteArray {
        val out = ByteArray(parts.sumOf(ByteArray::size))
        var offset = 0
        for (part in parts) {
            part.copyInto(out, offset)
            offset += part.size
        }
        return out
    }

    internal fun base64Url(bytes: ByteArray): String =
        java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    internal fun decodeBase64Url(value: String): ByteArray =
        java.util.Base64.getUrlDecoder().decode(value)

    private fun hex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }
}
