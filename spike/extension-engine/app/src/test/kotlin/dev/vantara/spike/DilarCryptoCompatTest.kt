package dev.vantara.spike

import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPair
import java.security.interfaces.ECPublicKey
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import org.junit.Assert.assertEquals
import org.junit.Test

class DilarCryptoCompatTest {
    @Test
    fun `decrypts independent dilar v12 browser-compatible vector`() {
        val template = DilarCryptoCompat.generateClientKeyPair().public as ECPublicKey
        val factory = KeyFactory.getInstance("EC")
        val privateScalar = BigInteger(
            "123456789abcdef123456789abcdef123456789abcdef123456789abcdef",
            16,
        )
        val clientRaw = DilarCryptoCompat.decodeBase64Url(
            "BJLeT0BaZJKF7DsBOs4AO_YW2aU4BcsKmXJxdhUiowOWV6Hk-QUKm3lG6ERolavWzbtC3gdQ9jjgeys9Pc8rYiU",
        )
        val clientPublic = factory.generatePublic(
            ECPublicKeySpec(
                ECPoint(
                    BigInteger(1, clientRaw.copyOfRange(1, 33)),
                    BigInteger(1, clientRaw.copyOfRange(33, 65)),
                ),
                template.params,
            ),
        )
        val clientPrivate = factory.generatePrivate(
            ECPrivateKeySpec(privateScalar, template.params),
        )
        val pair = KeyPair(clientPublic, clientPrivate)

        val plaintext = DilarCryptoCompat.decrypt(
            envelope = DilarEnvelope(
                version = 12,
                ephemeralPublicKey = DilarCryptoCompat.decodeBase64Url(
                    "BOYS7RoF0rN5KOReuiftbsUc7axEipExDlBPLN2cbGiaDeYXJwF8OxWA6vwNL0jrGVo4dq5nCtWds3LNyXJQ4ZY",
                ),
                epoch = 123456,
                iv = DilarCryptoCompat.decodeBase64Url("ABEiM0RVZneImaq7"),
                ciphertext = DilarCryptoCompat.decodeBase64Url(
                    "flgAQDZSBX4lEs9GK-jPb4PeJILlNtE7m2nQt--VRik_0wcCIwvlnjE1-sKhNLJjULXx7oToxzfd-hiUQuUM8k8WL7gpLfw7itdARPJ9QmXbEegEKS9J3vXO314",
                ),
                tag = DilarCryptoCompat.decodeBase64Url("rk9wU9slNB-eZ4kUjLrD9A"),
            ),
            clientKeyPair = pair,
        ).toString(Charsets.UTF_8)

        assertEquals(
            """{"storage_key":"abc123","pages":[{"url":"001.webp","order":1},{"url":"002.webp","order":2}]}""",
            plaintext,
        )
    }
}
