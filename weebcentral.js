// ─── WeebCentral Extension for Cinder ───────────────────────
//
// Searches and browses manga/manhwa/manhua from WeebCentral.com
// Uses HTML scraping since WeebCentral has no public JSON API.
//
// URL patterns:
//   Search:       https://weebcentral.com/search?text={query}&...
//   Series:       https://weebcentral.com/series/{ULID}
//   Chapter list: https://weebcentral.com/series/{ULID}/full-chapter-list
//   Chapter:      https://weebcentral.com/chapters/{ULID}

__cinderExport = {
	id: "weebcentral",
	name: "WeebCentral",
	version: "1.0.1",
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

	// ── HTML Parsing Helpers ─────────────────────────────────

	// Find all matches — takes pattern and flags as plain strings
	_matchAll: function(html, patternStr, flags) {
		var results = [];
		var re = new RegExp(patternStr, flags || "gi");
		var match;
		while ((match = re.exec(html)) !== null) {
			results.push(match);
		}
		return results;
	},

	// Return first capture group, or fallback
	_match: function(html, patternStr, flags, fallback) {
		if (fallback === undefined) { fallback = ""; }
		var re = new RegExp(patternStr, flags || "i");
		var m = re.exec(html);
		return m ? m[1].trim() : fallback;
	},

	// Decode common HTML entities
	_decode: function(str) {
		return str
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&apos;/g, "'");
	},

	// Strip all HTML tags
	_stripTags: function(str) {
		return str.replace(/<[^>]*>/g, "").trim();
	},

	// Extract series ULID from a /series/ URL
	_seriesIdFromUrl: function(url) {
		var m = /\/series\/([A-Z0-9]{20,})/i.exec(url);
		return m ? m[1] : null;
	},

	// Extract chapter ULID from a /chapters/ URL
	_chapterIdFromUrl: function(url) {
		var m = /\/chapters\/([A-Z0-9]{20,})/i.exec(url);
		return m ? m[1] : null;
	},

	// ── Search ───────────────────────────────────────────────

	search: async function(query, page) {
		if (page === undefined) { page = 1; }
		var limit = 20;
		var offset = (Math.max(1, page) - 1) * limit;

		var url =
			this.BASE_URL + "/search?text=" + encodeURIComponent(query) +
			"&limit=" + limit + "&offset=" + offset +
			"&official=Any&display_mode=Minimal%20Display" +
			"&sort=Best+Match&order=Ascending&status=Any&type=Any";

		var res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" }
		});

		if (res.status !== 200) {
			cinder.error("WeebCentral search failed: " + res.status);
			return [];
		}

		return this._parseSearchResults(res.data);
	},

	_parseSearchResults: function(html) {
		var results = [];
		var seen = {};

		var cards = this._matchAll(
			html,
			'<a[^>]+href="(\\/series\\/[A-Z0-9]{20,}[^"]*)"[^>]*>([\\s\\S]*?)<\\/a>',
			"gi"
		);

		for (var i = 0; i < cards.length; i++) {
			var href = cards[i][1];
			var inner = cards[i][2];

			var id = this._seriesIdFromUrl(href);
			if (!id || seen[id]) { continue; }
			seen[id] = true;

			var coverMatch = /src="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/.exec(inner);
			var cover = coverMatch ? coverMatch[1] : undefined;

			var titleFromSpan = this._match(inner, "<span[^>]*>\\s*([^<]{2,})\\s*<\\/span>", "i", "");
			var titleFromAlt = this._match(inner, 'alt="([^"]+)"', "i", "");
			var title = this._decode(titleFromSpan || titleFromAlt || "Unknown Title");

			results.push({
				id: id,
				title: title,
				cover: cover,
				url: this.BASE_URL + "/series/" + id,
				format: "manga"
			});
		}

		return results;
	},

	// ── Discover ─────────────────────────────────────────────

	getDiscoverSections: async function() {
		return [
			{ id: "hot-weekly",  title: "Hot This Week",    icon: "🔥" },
			{ id: "hot-monthly", title: "Hot This Month",   icon: "📈" },
			{ id: "hot-alltime", title: "All-Time Popular", icon: "⭐" },
			{ id: "latest",      title: "Latest Updates",   icon: "🆕" }
		];
	},

	getDiscoverItems: async function(sectionId, page) {
		if (page === undefined) { page = 0; }
		var limit = 20;
		var offset = page * limit;
		var url;

		if (sectionId === "latest") {
			url =
				this.BASE_URL + "/search?text=" +
				"&limit=" + limit + "&offset=" + offset +
				"&official=Any&display_mode=Minimal%20Display" +
				"&sort=Latest+Updates&order=Descending&status=Any&type=Any";
		} else {
			var period =
				sectionId === "hot-weekly"  ? "weekly"   :
				sectionId === "hot-monthly" ? "monthly"  : "all_time";
			url = this.BASE_URL + "/series/trending?period=" + period +
			      "&limit=" + limit + "&offset=" + offset;
		}

		var res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" }
		});

		if (res.status !== 200) { return []; }
		return this._parseSearchResults(res.data);
	},

	// ── Manga Details ─────────────────────────────────────────

	getMangaDetails: async function(id) {
		var url = this.BASE_URL + "/series/" + id;

		var res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" }
		});

		if (res.status !== 200) {
			throw new Error("Failed to fetch series page: " + res.status);
		}

		var html = res.data;

		var title = this._decode(
			this._match(html, "<h1[^>]*>\\s*([^<]+)\\s*<\\/h1>", "i", "") ||
			this._match(html, "<title>\\s*([^|<]+?)(?:\\s*[|].*)?<\\/title>", "i", "") ||
			"Unknown"
		);

		var cover =
			this._match(html, '<img[^>]+id="[^"]*cover[^"]*"[^>]+src="([^"]+)"', "i", "") ||
			this._match(html, '<img[^>]+class="[^"]*cover[^"]*"[^>]+src="([^"]+)"', "i", "") ||
			this._match(html, "src=\"(https:\\/\\/[^\"]+(?:cover|thumb)[^\"]*(?:jpg|jpeg|png|webp))\"", "i", "");

		var descRaw =
			this._match(html, '<p[^>]*class="[^"]*description[^"]*"[^>]*>([\\s\\S]*?)<\\/p>', "i", "") ||
			this._match(html, '<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\\s\\S]*?)<\\/div>', "i", "");
		var description = descRaw ? this._decode(this._stripTags(descRaw)) : "";

		var status = this._match(html, "Status[^>]*>\\s*(?:<[^>]+>)?\\s*([^<]{2,30})", "i", "");
		var author = this._decode(
			this._match(html, "Author[^>]*>\\s*(?:<[^>]+>)?\\s*([^<]{2,60})", "i", "")
		);

		var genreBlock =
			this._match(html, "Genres?[^>]*>([\\s\\S]*?)(?:<\\/(?:div|ul|section)>)", "i", "");
		var genreMatches = genreBlock
			? this._matchAll(genreBlock, "<a[^>]*>([^<]+)<\\/a>", "gi")
			: [];
		var genres = [];
		for (var g = 0; g < genreMatches.length; g++) {
			genres.push(this._decode(genreMatches[g][1].trim()));
		}

		return {
			id: id,
			title: title,
			cover: cover || undefined,
			description: description,
			author: author || undefined,
			status: status ? status.toLowerCase().trim() : undefined,
			genres: genres
		};
	},

	// ── Chapters ─────────────────────────────────────────────

	getChapters: async function(seriesId) {
		var url = this.BASE_URL + "/series/" + seriesId + "/full-chapter-list";

		var res = await cinder.fetch(url, {
			headers: {
				"User-Agent": "CinderApp/2.0 (iOS; Cinder)",
				"Accept": "text/html, */*"
			}
		});

		if (res.status !== 200) {
			throw new Error("Failed to fetch chapter list: " + res.status);
		}

		return this._parseChapterList(res.data);
	},

	_parseChapterList: function(html) {
		var chapters = [];

		var rows = this._matchAll(
			html,
			'<a[^>]+href="(\\/chapters\\/[A-Z0-9]{20,})"[^>]*>([\\s\\S]*?)<\\/a>',
			"gi"
		);

		for (var i = 0; i < rows.length; i++) {
			var href = rows[i][1];
			var inner = rows[i][2];

			var chapterId = this._chapterIdFromUrl(href);
			if (!chapterId) { continue; }

			var numStr =
				this._match(inner, "Chapter\\s+([\\d.]+)", "i", "") ||
				this._match(inner, "Ch\\.?\\s*([\\d.]+)", "i", "") ||
				this._match(inner, ">([\\d.]+)<\\/", "i", "") ||
				"0";
			var chapterNumber = parseFloat(numStr) || 0;

			var rawTitle = this._decode(this._stripTags(inner)).replace(/\s+/g, " ").trim();
			var title = rawTitle || ("Chapter " + numStr);

			var dateStr = this._match(inner, "(\\d{4}-\\d{2}-\\d{2})", "i", "");

			chapters.push({
				id: chapterId,
				title: title,
				chapterNumber: chapterNumber,
				dateUploaded: dateStr || undefined
			});
		}

		chapters.reverse();
		return chapters;
	},

	// ── Pages ─────────────────────────────────────────────────

	getPages: async function(chapterId) {
		var url = this.BASE_URL + "/chapters/" + chapterId;

		var res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" }
		});

		if (res.status !== 200) {
			throw new Error("Failed to fetch chapter: " + res.status);
		}

		return this._parsePages(res.data);
	},

	_parsePages: function(html) {
		var pages = [];
		var seen = {};

		var matches = this._matchAll(
			html,
			'<img[^>]+src="(https:\\/\\/(?:images\\.weebcentral\\.com|cdn\\.[^"]+)[^"]+(?:jpg|jpeg|png|webp)[^"]*)"',
			"gi"
		);

		for (var i = 0; i < matches.length; i++) {
			var imgUrl = matches[i][1];
			if (seen[imgUrl]) { continue; }
			seen[imgUrl] = true;
			pages.push({ url: imgUrl });
		}

		// Fallback: lazy-loaded data-src
		if (pages.length === 0) {
			var lazy = this._matchAll(
				html,
				'<img[^>]+data-src="(https:\\/\\/[^"]+(?:jpg|jpeg|png|webp)[^"]*)"',
				"gi"
			);
			for (var j = 0; j < lazy.length; j++) {
				var lazyUrl = lazy[j][1];
				if (seen[lazyUrl]) { continue; }
				seen[lazyUrl] = true;
				pages.push({ url: lazyUrl });
			}
		}

		return pages;
	},

	// ── Settings ─────────────────────────────────────────────

	getSettings: function() {
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
					{ label: "Manhua",  value: "Manhua" }
				]
			},
			{
				id: "sort_order",
				label: "Default Sort",
				type: "select",
				defaultValue: "Best Match",
				options: [
					{ label: "Best Match",     value: "Best+Match"     },
					{ label: "Latest Updates", value: "Latest+Updates" },
					{ label: "Most Popular",   value: "Most+Popular"   }
				]
			}
		];
	}
};
