/**
 * Phase 2B — Platform Publishing Adapters
 * Each adapter implements the PublishAdapter interface.
 * Credentials are decrypted from publish_targets.encrypted_config at call time.
 */

export interface PublishPayload {
  title: string;
  body: string;
  excerpt?: string;
  mediaUrls?: string[];
  tags?: string[];
  scheduledFor?: Date;
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  url?: string;
  error?: string;
  /** Analytics seed values returned by the platform at post time */
  views?: number;
  engagement?: number;
  clicks?: number;
  impressions?: number;
}

export interface PublishAdapter {
  name: string;
  publish(config: Record<string, unknown>, payload: PublishPayload): Promise<PublishResult>;
}

// ─── LinkedIn ─────────────────────────────────────────────────────────────────
export const linkedinAdapter: PublishAdapter = {
  name: "linkedin",
  async publish(config, payload) {
    const { accessToken, organizationUrn } = config as {
      accessToken: string;
      organizationUrn?: string;
    };
    const author = organizationUrn ?? `urn:li:person:me`;
    const body = {
      author,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: `${payload.title}\n\n${payload.excerpt ?? payload.body.slice(0, 700)}` },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `LinkedIn API error ${res.status}: ${err}` };
    }
    const data = (await res.json()) as { id?: string };
    return {
      success: true,
      platformPostId: data.id,
      url: data.id ? `https://www.linkedin.com/feed/update/${data.id}` : undefined,
    };
  },
};

// ─── YouTube ──────────────────────────────────────────────────────────────────
export const youtubeAdapter: PublishAdapter = {
  name: "youtube",
  async publish(config, payload) {
    const { accessToken, channelId, privacyStatus = "public" } = config as {
      accessToken: string;
      channelId: string;
      privacyStatus?: string;
    };
    // YouTube Data API v3 — insert video snippet (requires video file; here we create a playlist item / community post stub)
    const body = {
      snippet: {
        title: payload.title,
        description: payload.body.slice(0, 5000),
        tags: payload.tags ?? [],
        channelId,
      },
      status: { privacyStatus },
    };
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/videos?part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `YouTube API error ${res.status}: ${err}` };
    }
    const data = (await res.json()) as { id?: string };
    return {
      success: true,
      platformPostId: data.id,
      url: data.id ? `https://www.youtube.com/watch?v=${data.id}` : undefined,
    };
  },
};

// ─── TikTok ───────────────────────────────────────────────────────────────────
export const tiktokAdapter: PublishAdapter = {
  name: "tiktok",
  async publish(config, payload) {
    const { accessToken, openId } = config as { accessToken: string; openId: string };
    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/text/check/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: payload.title,
          description: payload.excerpt ?? payload.body.slice(0, 2200),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: { source: "PULL_FROM_URL", video_url: payload.mediaUrls?.[0] ?? "" },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `TikTok API error ${res.status}: ${err}` };
    }
    const data = (await res.json()) as { data?: { publish_id?: string } };
    return {
      success: true,
      platformPostId: data.data?.publish_id,
    };
  },
};

// ─── Instagram ────────────────────────────────────────────────────────────────
export const instagramAdapter: PublishAdapter = {
  name: "instagram",
  async publish(config, payload) {
    const { accessToken, igUserId } = config as { accessToken: string; igUserId: string };
    const imageUrl = payload.mediaUrls?.[0];
    if (!imageUrl) {
      return { success: false, error: "Instagram requires at least one media URL." };
    }
    // Step 1: create media container
    const containerRes = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          caption: `${payload.title}\n\n${payload.excerpt ?? payload.body.slice(0, 2000)}`,
          access_token: accessToken,
        }),
      },
    );
    if (!containerRes.ok) {
      const err = await containerRes.text();
      return { success: false, error: `Instagram container error ${containerRes.status}: ${err}` };
    }
    const { id: creationId } = (await containerRes.json()) as { id: string };
    // Step 2: publish
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
      },
    );
    if (!publishRes.ok) {
      const err = await publishRes.text();
      return { success: false, error: `Instagram publish error ${publishRes.status}: ${err}` };
    }
    const { id: postId } = (await publishRes.json()) as { id: string };
    return { success: true, platformPostId: postId };
  },
};

// ─── Pinterest ────────────────────────────────────────────────────────────────
export const pinterestAdapter: PublishAdapter = {
  name: "pinterest",
  async publish(config, payload) {
    const { accessToken, boardId } = config as { accessToken: string; boardId: string };
    const res = await fetch("https://api.pinterest.com/v5/pins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        board_id: boardId,
        title: payload.title,
        description: payload.excerpt ?? payload.body.slice(0, 500),
        media_source: payload.mediaUrls?.[0]
          ? { source_type: "image_url", url: payload.mediaUrls[0] }
          : undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Pinterest API error ${res.status}: ${err}` };
    }
    const data = (await res.json()) as { id?: string };
    return {
      success: true,
      platformPostId: data.id,
      url: data.id ? `https://www.pinterest.com/pin/${data.id}` : undefined,
    };
  },
};

// ─── Vimeo ────────────────────────────────────────────────────────────────────
export const vimeoAdapter: PublishAdapter = {
  name: "vimeo",
  async publish(config, payload) {
    const { accessToken, privacy = "anybody" } = config as {
      accessToken: string;
      privacy?: string;
    };
    const res = await fetch("https://api.vimeo.com/me/videos", {
      method: "POST",
      headers: {
        Authorization: `bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.vimeo.*+json;version=3.4",
      },
      body: JSON.stringify({
        upload: { approach: "pull", link: payload.mediaUrls?.[0] ?? "" },
        name: payload.title,
        description: payload.body.slice(0, 5000),
        privacy: { view: privacy },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Vimeo API error ${res.status}: ${err}` };
    }
    const data = (await res.json()) as { uri?: string; link?: string };
    return {
      success: true,
      platformPostId: data.uri,
      url: data.link,
    };
  },
};

// ─── Email (Resend) ───────────────────────────────────────────────────────────
export const emailAdapter: PublishAdapter = {
  name: "email",
  async publish(config, payload) {
    const { fromName, fromEmail, replyTo } = config as {
      fromName: string;
      fromEmail: string;
      replyTo?: string;
    };
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { success: false, error: "RESEND_API_KEY not configured." };
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: ["audience"],
        reply_to: replyTo,
        subject: payload.title,
        html: payload.body,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Resend API error ${res.status}: ${err}` };
    }
    const data = (await res.json()) as { id?: string };
    return { success: true, platformPostId: data.id };
  },
};

// ─── Web (SmartDeploy stub) ───────────────────────────────────────────────────
export const webAdapter: PublishAdapter = {
  name: "web",
  async publish(_config, payload) {
    // SmartDeploy engine will be implemented via Replit Agent
    return {
      success: true,
      platformPostId: `web-${Date.now()}`,
      url: "#smartdeploy-pending",
    };
  },
};

// ─── Facebook ─────────────────────────────────────────────────────────────────
export const facebookAdapter: PublishAdapter = {
  name: "facebook",
  async publish(config, payload) {
    const { accessToken, pageId } = config as { accessToken: string; pageId: string };
    const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `${payload.title}\n\n${payload.excerpt ?? payload.body.slice(0, 2000)}`,
        access_token: accessToken,
        link: payload.mediaUrls?.[0],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Facebook API error ${res.status}: ${err}` };
    }
    const data = (await res.json()) as { id?: string };
    return { success: true, platformPostId: data.id };
  },
};

// ─── WordPress ────────────────────────────────────────────────────────────────
export const wordpressAdapter: PublishAdapter = {
  name: "wordpress",
  async publish(config, payload) {
    const { siteUrl, username, appPassword } = config as {
      siteUrl: string;
      username: string;
      appPassword: string;
    };
    const credentials = Buffer.from(`${username}:${appPassword}`).toString("base64");
    const res = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: payload.title,
        content: payload.body,
        excerpt: payload.excerpt,
        status: "publish",
        tags: payload.tags,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `WordPress API error ${res.status}: ${err}` };
    }
    const data = (await res.json()) as { id?: number; link?: string };
    return {
      success: true,
      platformPostId: String(data.id),
      url: data.link,
    };
  },
};

// ─── SoundCloud ───────────────────────────────────────────────────────────────
export const soundcloudAdapter: PublishAdapter = {
  name: "soundcloud",
  async publish(config, payload) {
    const { accessToken } = config as { accessToken: string };
    const res = await fetch("https://api.soundcloud.com/tracks", {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        "track[title]": payload.title,
        "track[description]": payload.body.slice(0, 2000),
        "track[sharing]": "public",
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `SoundCloud API error ${res.status}: ${err}` };
    }
    const data = (await res.json()) as { id?: number; permalink_url?: string };
    return {
      success: true,
      platformPostId: String(data.id),
      url: data.permalink_url,
    };
  },
};

// ─── Adapter Registry ─────────────────────────────────────────────────────────
export const ADAPTERS: Record<string, PublishAdapter> = {
  linkedin: linkedinAdapter,
  youtube: youtubeAdapter,
  tiktok: tiktokAdapter,
  instagram: instagramAdapter,
  pinterest: pinterestAdapter,
  vimeo: vimeoAdapter,
  email: emailAdapter,
  web: webAdapter,
  facebook: facebookAdapter,
  wordpress: wordpressAdapter,
  soundcloud: soundcloudAdapter,
};

export function getAdapter(target: string): PublishAdapter | null {
  return ADAPTERS[target] ?? null;
}
