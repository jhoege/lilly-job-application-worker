# Supervised LinkedIn browser access

The worker includes a temporary remote-browser interface at `/auth-browser/`. **It is disabled by default**. To enable it, configure a randomly generated secret of at least 32 bytes in the Railway variable `BROWSER_ACCESS_KEY` and expose the service through an HTTPS Railway domain. Never commit the secret to GitHub or send it through chat.

Access is protected by a 20-minute, HttpOnly, Secure, SameSite=Strict session cookie. Failed unlocks are rate-limited. The interface shows Chromium screenshots and lets the owner click, type, and press Enter. It opens only the LinkedIn sign-in URL automatically; it does not submit job applications. The password and verification code pass directly from the owner's browser to their own Railway service over HTTPS; do not record browser traffic or use this interface on an untrusted network.

**Important limitations:** this is a supervised login tool, not a hardened multi-user remote-desktop product. Browser screenshots can contain private account data. Only enable it temporarily, disable/remove `BROWSER_ACCESS_KEY` after sign-in, and avoid leaving the service publicly exposed. The access key is not the LinkedIn password. Use an isolated browser profile and don't reuse the worker for unrelated sites.

Before enabling: verify Railway deploy succeeded, persistent volume is attached at `/data`, and Chromium initialized. After signing in: close access, disable the key, and verify browser session continuity on restart. No automated job applications are implemented yet.
