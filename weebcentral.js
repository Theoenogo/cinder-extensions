// WeebCentral Extension for Cinder
// Manga, manhwa, and manhua from WeebCentral.com

__cinderExport = {
	id: "weebcentral",
	name: "WeebCentral",
	version: "1.0.3",
	icon: "📚",
	description: "Read manga, manhwa, and manhua from WeebCentral.com",
	contentType: "manga",

	capabilities: {
		search: true,
		discover: true,
		download: false,
		resolve: false,
		manga: true,
	},

	BASE_URL: "https://weebcentral.com",
	COVER_URL: "https://temp.compsci88.com/cover/fallback/",

	// Cover URLs follow a simple pattern — construct directly from series ULID
	_coverUrl(id) {
		return this.COVER_URL + id + ".jpg";
	},

	// Find all regex matches, returns array of match arrays
	_matchAll(html, patternStr, flags) {
		const results = [];
		const re = new RegExp(patternStr, flags || "gi");
		let match;
		while ((match = re.exec(html)) !== null) {
			results.push(match);
		}
		return results;
	},

	// Return first capture group or fallback
	_match(html, patternStr, flags, fallback = "") {
		const re = new RegExp(patternStr, flags || "i");
		const m = re.exec(html);
		return m ? m[1].trim() : fallback;
	},

	_decode(str) {
		return str
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&apos;/g, "'");
	},

	_stripTags(str) {
		return str.replace(/<[^>]*>/g, "").trim();
	},

	_seriesIdFromUrl(url) {
		const m = /\/series\/([A-Z0-9]{20,})/i.exec(url);
		return m ? m[1] : null;
	},

	_chapterIdFromUrl(url) {
		const m = /\/chapters\/([A-Z0-9]{20,})/i.exec(url);
		return m ? m[1] : null;
	},

	// --- Search ---
	// WeebCentral quick search uses POST to /search/simple
	// Full search page uses GET /search?text=...
	// We try POST first (same endpoint the site uses) then fall back to GET

	async search(query, page = 1) {
		const limit = 20;
		const offset = (Math.max(1, page) - 1) * limit;

		// Try the simple search POST endpoint (used by the site's own quick search)
		const res = await cinder.fetch(
			this.BASE_URL + "/search/simple?location=main&limit=" + limit + "&offset=" + offset,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"User-Agent": "CinderApp/2.0 (iOS; Cinder)",
					"HX-Request": "true",
				},
				body: "text=" + encodeURIComponent(query),
			}
		);

		if (res.status === 200 && res.data && res.data.length > 10) {
			const results = this._parseSearchResults(res.data);
			if (results.length > 0) { return results; }
		}

		// Fallback: GET /search?text=...
		const fallback = await cinder.fetch(
			this.BASE_URL + "/search?text=" + encodeURIComponent(query) +
			"&limit=" + limit + "&offset=" + offset +
			"&official=Any&display_mode=Minimal%20Display&sort=Best+Match&order=Ascending&status=Any&type=Any",
			{
				headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" }
			}
		);

		if (fallback.status !== 200) {
			cinder.error("WeebCentral search failed: " + fallback.status);
			return [];
		}

		return this._parseSearchResults(fallback.data);
	},

	_parseSearchResults(html) {
		const results = [];
		const seen = {};

		// Match all <a href="/series/ULID..."> links
		const links = this._matchAll(
			html,
			'href="(https?://weebcentral\\.com/series/([A-Z0-9]{20,})[^"]*)"',
			"gi"
		);

		for (const link of links) {
			const href = link[1];
			const id = link[2];
			if (seen[id]) { continue; }
			seen[id] = true;

			// Extract title from alt="TITLE cover" pattern on the nearby img tag
			// Search a window of text around this href match
			const pos = html.indexOf(link[0]);
			const window = html.substring(pos, pos + 800);

			// Try alt="Title cover" first (most reliable)
			let title = this._match(window, 'alt="([^"]+)\\s+cover"', "i", "");

			// Try title in a div with truncate class
			if (!title) {
				title = this._match(window, '<div[^>]*truncate[^>]*>([^<]{2,})<\\/div>', "i", "");
			}

			// Try any visible text as last resort
			if (!title) {
				title = this._decode(this._stripTags(window.substring(0, 200))).trim();
				if (title.length > 100) { title = title.substring(0, 100); }
			}

			if (!title) { continue; }
			title = this._decode(title.trim());

			results.push({
				id: id,
				title: title,
				cover: this._coverUrl(id),
				url: this.BASE_URL + "/series/" + id,
				format: "manga",
			});
		}

		return results;
	},

	// --- Discover ---

	async getDiscoverSections() {
		return [
			{ id: "latest",      title: "Latest Updates",   icon: "🆕" },
			{ id: "hot-weekly",  title: "Hot This Week",    icon: "🔥" },
			{ id: "hot-monthly", title: "Hot This Month",   icon: "📈" },
			{ id: "hot-alltime", title: "All-Time Popular", icon: "⭐" },
		];
	},

	async getDiscoverItems(sectionId, page = 0) {
		const limit = 20;
		const offset = page * limit;

		const sort = sectionId === "latest" ? "Latest+Updates" : "Most+Popular";
		const order = sectionId === "latest" ? "Descending" : "Descending";

		const url =
			this.BASE_URL + "/search?text=" +
			"&limit=" + limit + "&offset=" + offset +
			"&official=Any&display_mode=Minimal%20Display" +
			"&sort=" + sort + "&order=" + order + "&status=Any&type=Any";

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" }
		});

		if (res.status !== 200) { return []; }
		return this._parseSearchResults(res.data);
	},

	// --- Manga Details ---

	async getMangaDetails(id) {
		const url = this.BASE_URL + "/series/" + id;

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" }
		});

		if (res.status !== 200) {
			throw new Error("Failed to fetch series: " + res.status);
		}

		const html = res.data;

		// Title: <h1 class="...">One Piece</h1>
		const title = this._decode(
			this._match(html, '<h1[^>]*>\\s*([^<]+?)\\s*<\\/h1>', "i", "Unknown")
		);

		// Cover: construct from ID directly
		const cover = this._coverUrl(id);

		// Description: <p class="whitespace-pre-wrap break-words">...</p>
		const descRaw = this._match(
			html,
			'<p[^>]*whitespace-pre-wrap[^>]*>([\\s\\S]*?)<\\/p>',
			"i",
			""
		);
		const description = descRaw ? this._decode(this._stripTags(descRaw)) : "";

		// Author: find "Author(s):" block then grab the first <a> text
		const authorBlock = this._match(html, 'Author\\(s\\)[^<]*<\\/strong>([\\s\\S]*?)<\\/li>', "i", "");
		const author = authorBlock
			? this._decode(this._match(authorBlock, '>([^<]{2,})<\\/a>', "i", ""))
			: "";

		// Status: find "Status:" block then grab the <a> text
		const statusBlock = this._match(html, '<strong>Status[^<]*<\\/strong>([\\s\\S]*?)<\\/li>', "i", "");
		const status = statusBlock
			? this._decode(this._match(statusBlock, '>([^<]{2,})<\\/a>', "i", ""))
			: "";

		// Tags: find "Tags(s):" block then grab all <a> texts
		const tagsBlock = this._match(html, 'Tags\\(s\\)[^<]*<\\/strong>([\\s\\S]*?)<\\/li>', "i", "");
		const tagMatches = tagsBlock
			? this._matchAll(tagsBlock, '>([^<,]+)<\\/a>', "gi")
			: [];
		const genres = tagMatches.map(m => this._decode(m[1].trim()));

		return {
			id: id,
			title: title,
			cover: cover,
			description: description,
			author: author || undefined,
			status: status ? status.toLowerCase().trim() : undefined,
			genres: genres,
		};
	},

	// --- Chapters ---
	// WeebCentral shows a truncated list on the series page.
	// The /full-chapter-list endpoint returns the complete HTML list via HTMX.

	async getChapters(seriesId) {
		const url = this.BASE_URL + "/series/" + seriesId + "/full-chapter-list";

		const res = await cinder.fetch(url, {
			headers: {
				"User-Agent": "CinderApp/2.0 (iOS; Cinder)",
				"HX-Request": "true",
				"Accept": "text/html, */*",
			}
		});

		if (res.status !== 200) {
			throw new Error("Failed to fetch chapter list: " + res.status);
		}

		return this._parseChapterList(res.data);
	},

	_parseChapterList(html) {
		const chapters = [];

		// Chapter links: <a href="https://weebcentral.com/chapters/ULID" class="...">
		const rows = this._matchAll(
			html,
			'href="https://weebcentral\\.com/chapters/([A-Z0-9]{20,})"[^>]*>([\\s\\S]*?)<\\/a>',
			"gi"
		);

		for (const row of rows) {
			const chapterId = row[1];
			const inner = row[2];

			// Chapter number: <span class="">Chapter 1181</span>
			const numStr = this._match(inner, '<span[^>]*>\\s*Chapter\\s+([\\d.]+)\\s*<\\/span>', "i", "0");
			const chapterNumber = parseFloat(numStr) || 0;

			// Date: datetime="2026-04-24T12:02:31.353Z" on <time> tag
			const dateStr = this._match(inner, 'datetime="([^"]+)"', "i", "");

			const title = "Chapter " + (numStr || "?");

			chapters.push({
				id: chapterId,
				title: title,
				chapterNumber: chapterNumber,
				dateUploaded: dateStr || undefined,
			});
		}

		// full-chapter-list returns newest first — reverse to ascending
		chapters.reverse();
		return chapters;
	},

	// --- Pages ---

	async getPages(chapterId) {
		const url = this.BASE_URL + "/chapters/" + chapterId;

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" }
		});

		if (res.status !== 200) {
			throw new Error("Failed to fetch chapter: " + res.status);
		}

		return this._parsePages(res.data);
	},

	_parsePages(html) {
		const pages = [];
		const seen = {};

		// Images served from temp.compsci88.com CDN
		// Match src="https://..." on <img> tags
		const patterns = [
			'<img[^>]+src="(https://[^"]+\\.(?:jpg|jpeg|png|webp)(?:\\?[^"]*)?)"',
			'<img[^>]+data-src="(https://[^"]+\\.(?:jpg|jpeg|png|webp)(?:\\?[^"]*)?)"',
		];

		for (const pattern of patterns) {
			const matches = this._matchAll(html, pattern, "gi");
			for (const m of matches) {
				const imgUrl = m[1];
				// Skip small UI images (icons, logos etc.)
				if (imgUrl.includes("/static/") || imgUrl.includes("favicon")) { continue; }
				if (seen[imgUrl]) { continue; }
				seen[imgUrl] = true;
				pages.push({ url: imgUrl });
			}
			if (pages.length > 0) { break; }
		}

		return pages;
	},

	// --- Settings ---

	getSettings() {
		return [
			{
				id: "content_type",
				label: "Content Type",
				type: "select",
				defaultValue: "Any",
				options: [
					{ label: "All",     value: "Any"    },
					{ label: "Manga",   value: "Manga"  },
					{ label: "Manhwa",  value: "Manhwa" },
					{ label: "Manhua",  value: "Manhua" },
				],
			},
		];
	},
};
