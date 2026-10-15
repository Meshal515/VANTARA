package com.vantara.anime.player.together

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TogetherAvatarTest {
    @Test fun joinedMemberRetainsTheMatchingInviteePhotoUntilTheirProfileArrives() {
        val invited = listOf(Invitee("friend", "Friend", "/avatars/friend.webp"))
        assertEquals("/avatars/friend.webp", roomAvatarKey("friend", null, invited))
        assertEquals("/avatars/friend.webp", roomAvatarKey("friend", "", invited))
        assertEquals("https://example.com/new-photo.webp", roomAvatarKey("friend", "https://example.com/new-photo.webp", invited))
        assertNull(roomAvatarKey("someone-else", null, invited))
    }
}
