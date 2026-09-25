@file:Suppress("PropertyName")

package eu.kanade.tachiyomi.animesource.model

/** تنفيذ المستضيف لـ[SEpisode] (Aniyomi source-api، Apache-2.0). */
class SEpisodeImpl : SEpisode {
    override lateinit var url: String
    override lateinit var name: String
    override var episode_number: Float = -1f
    override var fillermark: Boolean = false
    override var scanlator: String? = null
    override var date_upload: Long = 0
    override var summary: String? = null
    override var preview_url: String? = null
}
