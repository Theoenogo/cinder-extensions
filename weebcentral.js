// WeebCentral Extension for Cinder
// Manga, manhwa, and manhua from WeebCentral.com
// Uses HTML scraping - no public JSON API available.

__cinderExport = {
	id: "weebcentral",
	name: "WeebCentral",
	version: "1.0.2",
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

	// --- Helpers ---

	_matchAll(html, patternStr, flags) {
		const results = [];
		const re = new RegExp(patternStr, flags || "gi");
		let match;
		while ((match = re.exec(html)) !== null) {
			results.push(match);
		}
		return results;
	},

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

	async search(query, page = 1) {
		const limit = 20;
		const offset = (Math.max(1, page) - 1) * limit;
		const url =
			this.BASE_URL + "/search?text=" + encodeURIComponent(query) +
			"&limit=" + limit + "&offset=" + offset +
			"&official=Any&display_mode=Minimal%20Display" +
			"&sort=Best+Match&order=Ascending&status=Any&type=Any";

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" }
		});

		if (res.status !== 200) {
			cinder.error("WeebCentral search failed: " + res.status);
			return [];
		}

		return this._parseSearchResults(res.data);
	},

	_parseSearchResults(html) {
		const results = [];
		const seen = {};

		const cards = this._matchAll(
			html,
			'<a[^>]+href="(\\/series\\/[A-Z0-9]{20,}[^"]*)"[^>]*>([\\s\\S]*?)<\\/a>',
			"gi"
		);

		for (const card of cards) {
			const href = card[1];
			const inner = card[2];
			const id = this._seriesIdFromUrl(href);
			if (!id || seen[id]) { continue; }
			seen[id] = true;

			const coverMatch = /src="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/.exec(inner);
			const cover = coverMatch ? coverMatch[1] : undefined;

			const titleFromSpan = this._match(inner, "<span[^>]*>\\s*([^<]{2,})\\s*<\\/span>", "i", "");
			const titleFromAlt = this._match(inner, 'alt="([^"]+)"', "i", "");
			const title = this._decode(titleFromSpan || titleFromAlt || "Unknown Title");

			results.push({
				id: id,
				title: title,
				cover: cover,
				url: this.BASE_URL + "/series/" + id,
				format: "manga",
			});
		}

		return results;
	},

	// --- Discover ---

	async getDiscoverSections() {
		return [
			{ id: "hot-weekly",  title: "Hot This Week",    icon: "🔥" },
			{ id: "hot-monthly", title: "Hot This Month",   icon: "📈" },
			{ id: "hot-alltime", title: "All-Time Popular", icon: "⭐" },
			{ id: "latest",      title: "Latest Updates",   icon: "🆕" },
		];
	},

	async getDiscoverItems(sectionId, page = 0) {
		const limit = 20;
		const offset = page * limit;
		let url;

		if (sectionId === "latest") {
			url =
				this.BASE_URL + "/search?text=" +
				"&limit=" + limit + "&offset=" + offset +
				"&official=Any&display_mode=Minimal%20Display" +
				"&sort=Latest+Updates&order=Descending&status=Any&type=Any";
		} else {
			const period =
				sectionId === "hot-weekly"  ? "weekly"  :
				sectionId === "hot-monthly" ? "monthly" : "all_time";
			url = this.BASE_URL + "/series/trending?period=" + period +
			      "&limit=" + limit + "&offset=" + offset;
		}

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

		const title = this._decode(
			this._match(html, "<h1[^>]*>\\s*([^<]+)\\s*<\\/h1>", "i", "") ||
			this._match(html, "<title>\\s*([^|<]+?)(?:\\s*[|].*)?<\\/title>", "i", "") ||
			"Unknown"
		);

		const cover =
			this._match(html, '<img[^>]+id="[^"]*cover[^"]*"[^>]+src="([^"]+)"', "i", "") ||
			this._match(html, '<img[^>]+class="[^"]*cover[^"]*"[^>]+src="([^"]+)"', "i", "") ||
			"";

		const descRaw =
			this._match(html, '<p[^>]*class="[^"]*description[^"]*"[^>]*>([\\s\\S]*?)<\\/p>', "i", "") ||
			this._match(html, '<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\\s\\S]*?)<\\/div>', "i", "");
		const description = descRaw ? this._decode(this._stripTags(descRaw)) : "";

		const status = this._match(html, "Status[^>]*>\\s*(?:<[^>]+>)?\\s*([^<]{2,30})", "i", "");
		const author = this._decode(
			this._match(html, "Author[^>]*>\\s*(?:<[^>]+>)?\\s*([^<]{2,60})", "i", "")
		);

		const genreBlock =
			this._match(html, "Genres?[^>]*>([\\s\\S]*?)(?:<\\/(?:div|ul|section)>)", "i", "");
		const genreMatches = genreBlock
			? this._matchAll(genreBlock, "<a[^>]*>([^<]+)<\\/a>", "gi")
			: [];
		const genres = genreMatches.map(m => this._decode(m[1].trim()));

		return {
			id: id,
			title: title,
			cover: cover || undefined,
			description: description,
			author: author || undefined,
			status: status ? status.toLowerCase().trim() : undefined,
			genres: genres,
		};
	},

	// --- Chapters ---

	async getChapters(seriesId) {
		const url = this.BASE_URL + "/series/" + seriesId + "/full-chapter-list";

		const res = await cinder.fetch(url, {
			headers: {
				"User-Agent": "CinderApp/2.0 (iOS; Cinder)",
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

		const rows = this._matchAll(
			html,
			'<a[^>]+href="(\\/chapters\\/[A-Z0-9]{20,})"[^>]*>([\\s\\S]*?)<\\/a>',
			"gi"
		);

		for (const row of rows) {
			const chapterId = this._chapterIdFromUrl(row[1]);
			if (!chapterId) { continue; }

			const inner = row[2];
			const numStr =
				this._match(inner, "Chapter\\s+([\\d.]+)", "i", "") ||
				this._match(inner, "Ch\\.?\\s*([\\d.]+)", "i", "") ||
				"0";
			const chapterNumber = parseFloat(numStr) || 0;

			const rawTitle = this._decode(this._stripTags(inner)).replace(/\s+/g, " ").trim();
			const title = rawTitle || ("Chapter " + numStr);
			const dateStr = this._match(inner, "(\\d{4}-\\d{2}-\\d{2})", "i", "");

			chapters.push({
				id: chapterId,
				title: title,
				chapterNumber: chapterNumber,
				dateUploaded: dateStr || undefined,
			});
		}

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

		const matches = this._matchAll(
			html,
			'<img[^>]+src="(https:\\/\\/(?:images\\.weebcentral\\.com|cdn\\.[^"]+)[^"]+(?:jpg|jpeg|png|webp)[^"]*)"',
			"gi"
		);

		for (const m of matches) {
			const imgUrl = m[1];
			if (seen[imgUrl]) { continue; }
			seen[imgUrl] = true;
			pages.push({ url: imgUrl });
		}

		if (pages.length === 0) {
			const lazy = this._matchAll(
				html,
				'<img[^>]+data-src="(https:\\/\\/[^"]+(?:jpg|jpeg|png|webp)[^"]*)"',
				"gi"
			);
			for (const m of lazy) {
				const imgUrl = m[1];
				if (seen[imgUrl]) { continue; }
				seen[imgUrl] = true;
				pages.push({ url: imgUrl });
			}
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
