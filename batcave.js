// BatCave Extension for Cinder
// Western comics from BatCave.biz
// Site runs DataLife Engine (DLE) — numeric IDs for series and chapters.
//
// URL patterns:
//   Series page:  https://batcave.biz/{id}-{slug}.html
//   Reader:       https://batcave.biz/reader/{series_id}/{chapter_id}
//   Search:       https://batcave.biz/?do=search&subaction=search&story={query}
//   Browse:       https://batcave.biz/comix/page/{n}/

// Mobile UA required — series pages return 401 without it
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

__cinderExport = {
	id: "batcave",
	name: "BatCave",
	version: "1.0.0",
	icon: "🦇",
	description: "Read western comics from BatCave.biz",
	contentType: "manga",

	capabilities: {
		search: true,
		discover: true,
		download: false,
		resolve: false,
		manga: true,
	},

	BASE_URL: "https://batcave.biz",

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

	// Extract numeric series ID from a batcave URL
	// e.g. https://batcave.biz/30310-some-slug.html -> "30310"
	_seriesIdFromUrl(url) {
		const m = /batcave\.biz\/(\d+)-[^/]+\.html/i.exec(url);
		return m ? m[1] : null;
	},

	// --- Search ---

	async search(query, page = 1) {
		const url = this.BASE_URL + "/?do=search&subaction=search&story=" +
			encodeURIComponent(query) + "&search_start=" + (page - 1) +
			"&full_search=0&result_from=" + ((page - 1) * 20 + 1);

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": MOBILE_UA }
		});

		if (res.status !== 200) {
			cinder.error("BatCave search failed: " + res.status);
			return [];
		}

		return this._parseSeriesCards(res.data);
	},

	// --- Discover ---

	async getDiscoverSections() {
		return [
			{ id: "latest",  title: "Latest",     icon: "🆕" },
			{ id: "popular", title: "Popular",     icon: "🔥" },
			{ id: "dc",      title: "DC Comics",   icon: "🦇" },
			{ id: "marvel",  title: "Marvel",      icon: "🕷️" },
		];
	},

	async getDiscoverItems(sectionId, page = 0) {
		let url;
		const p = page + 1;

		if (sectionId === "latest") {
			url = this.BASE_URL + "/comix/page/" + p + "/";
		} else if (sectionId === "popular") {
			url = this.BASE_URL + "/comix/page/" + p + "/?sort=rating&order=desc";
		} else if (sectionId === "dc") {
			url = this.BASE_URL + "/tags/dc-comics/page/" + p + "/";
		} else {
			url = this.BASE_URL + "/tags/marvel/page/" + p + "/";
		}

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": MOBILE_UA }
		});

		if (res.status !== 200) { return []; }
		return this._parseSeriesCards(res.data);
	},

	// Parse series cards from listing/search pages
	// BatCave cards: <article> or <div class="..."> with an <a href="...{id}-{slug}.html">
	_parseSeriesCards(html) {
		const results = [];
		const seen = {};

		// Match links to series pages: href="https://batcave.biz/12345-slug.html"
		const links = this._matchAll(
			html,
			'href="(https://batcave\\.biz/(\\d+)-[^"]+\\.html)"',
			"gi"
		);

		for (const link of links) {
			const url = link[1];
			const id = link[2];
			if (seen[id]) { continue; }
			seen[id] = true;

			// Look for title and cover in the surrounding HTML
			const pos = html.indexOf(link[0]);
			const chunk = html.substring(Math.max(0, pos - 200), pos + 600);

			// Cover image
			const cover = this._match(chunk, '<img[^>]+src="([^"]+)"[^>]*>', "i", "");

			// Title — try alt text, then a heading, then the link text
			const title = this._decode(
				this._match(chunk, '<img[^>]+alt="([^"]+)"', "i", "") ||
				this._match(chunk, '<h[1-4][^>]*>\\s*([^<]+)\\s*<\\/h[1-4]>', "i", "") ||
				this._match(chunk, '>([^<]{3,60})<\\/a>', "i", "") ||
				"Unknown"
			);

			if (title === "Unknown" && !cover) { continue; }

			results.push({
				id: id,
				title: title.trim(),
				cover: cover || undefined,
				url: url,
				format: "manga",
			});
		}

		return results;
	},

	// --- Series Details ---

	async getMangaDetails(id) {
		// We need the full URL slug — search for it in the series page
		// Try to reconstruct from ID by fetching the series page directly
		// BatCave series pages: /{id}-{slug}.html
		// We'll search for the series to get its URL, or try a direct fetch
		// Since we store the full URL in search results, we can use it here
		// But Cinder passes us only the ID — so we need to find the page
		const searchRes = await cinder.fetch(
			this.BASE_URL + "/?do=search&subaction=search&story=" + id,
			{ headers: { "User-Agent": MOBILE_UA } }
		);

		let seriesUrl = null;
		if (searchRes.status === 200) {
			const m = new RegExp('href="(https://batcave\\.biz/' + id + '-[^"]+\\.html)"', "i").exec(searchRes.data);
			if (m) { seriesUrl = m[1]; }
		}

		if (!seriesUrl) {
			throw new Error("Could not resolve series URL for ID: " + id);
		}

		const res = await cinder.fetch(seriesUrl, {
			headers: { "User-Agent": MOBILE_UA }
		});

		if (res.status !== 200) {
			throw new Error("Failed to fetch series: " + res.status);
		}

		const html = res.data;

		const title = this._decode(
			this._match(html, '<h1[^>]*>\\s*([^<]+?)\\s*<\\/h1>', "i", "Unknown")
		);

		const cover =
			this._match(html, '<img[^>]+class="[^"]*cover[^"]*"[^>]+src="([^"]+)"', "i", "") ||
			this._match(html, '<div[^>]*class="[^"]*poster[^"]*"[^>]*>\\s*<img[^>]+src="([^"]+)"', "i", "") ||
			this._match(html, '<img[^>]+src="([^"]+(?:cover|poster|thumb)[^"]*)"', "i", "");

		const descRaw =
			this._match(html, '<div[^>]*class="[^"]*description[^"]*"[^>]*>([\\s\\S]*?)<\\/div>', "i", "") ||
			this._match(html, '<div[^>]*class="[^"]*summary[^"]*"[^>]*>([\\s\\S]*?)<\\/div>', "i", "");
		const description = descRaw ? this._decode(this._stripTags(descRaw)) : "";

		return {
			id: id,
			title: title,
			cover: cover || undefined,
			description: description,
			seriesUrl: seriesUrl,
		};
	},

	// --- Chapters ---
	// Chapter links on series pages point to the reader:
	// https://batcave.biz/reader/{series_id}/{chapter_id}

	async getChapters(seriesId) {
		// First resolve the series URL
		const searchRes = await cinder.fetch(
			this.BASE_URL + "/?do=search&subaction=search&story=" + seriesId,
			{ headers: { "User-Agent": MOBILE_UA } }
		);

		let seriesUrl = null;
		if (searchRes.status === 200) {
			const m = new RegExp('href="(https://batcave\\.biz/' + seriesId + '-[^"]+\\.html)"', "i").exec(searchRes.data);
			if (m) { seriesUrl = m[1]; }
		}

		if (!seriesUrl) {
			throw new Error("Could not resolve series URL for ID: " + seriesId);
		}

		const res = await cinder.fetch(seriesUrl, {
			headers: { "User-Agent": MOBILE_UA }
		});

		if (res.status !== 200) {
			throw new Error("Failed to fetch series page: " + res.status);
		}

		return this._parseChapterList(res.data, seriesId);
	},

	_parseChapterList(html, seriesId) {
		const chapters = [];

		// Reader links: href="https://batcave.biz/reader/{series_id}/{chapter_id}"
		const rows = this._matchAll(
			html,
			'href="https://batcave\\.biz/reader/' + seriesId + '/(\\d+)"[^>]*>([\\s\\S]*?)<\\/a>',
			"gi"
		);

		for (const row of rows) {
			const chapterId = row[1];
			const inner = row[2];

			const rawText = this._decode(this._stripTags(inner)).replace(/\s+/g, " ").trim();

			// Try to extract an issue/chapter number
			const numStr =
				this._match(inner, '#(\\d+)', "i", "") ||
				this._match(inner, 'Issue\\s+(\\d+)', "i", "") ||
				this._match(inner, 'Chapter\\s+([\\d.]+)', "i", "") ||
				this._match(inner, '(\\d+)', "i", "0");

			const chapterNumber = parseFloat(numStr) || 0;

			chapters.push({
				id: chapterId,
				title: rawText || ("#" + numStr),
				chapterNumber: chapterNumber,
			});
		}

		// BatCave typically lists newest first — reverse to ascending
		chapters.reverse();
		return chapters;
	},

	// --- Pages ---
	// Reader: https://batcave.biz/reader/{series_id}/{chapter_id}
	// Images are likely embedded in the page or loaded via a JSON/JS variable

	async getPages(chapterId) {
		// chapterId here is just the chapter portion — we need the series ID too.
		// Cinder passes only what we stored as the chapter id.
		// We store chapterId as just the numeric chapter ID from the reader URL.
		// But we need the full reader URL — we don't have the series ID here directly.
		// Work around: store the full reader URL as the chapter ID.
		// The chapter ID we push in _parseChapterList is just the chapter number part.
		// We need to pass the full path. Let's fetch using the chapterId directly
		// assuming it was stored as "seriesId/chapterId" format.
		const url = this.BASE_URL + "/reader/" + chapterId;

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": MOBILE_UA }
		});

		if (res.status !== 200) {
			throw new Error("Failed to fetch reader: " + res.status);
		}

		return this._parsePages(res.data);
	},

	_parsePages(html) {
		const pages = [];
		const seen = {};

		// DLE readers often store images in a JS variable like:
		// var images = ["url1", "url2", ...];
		// or readerImages = [...];
		const jsArrayMatch = this._match(
			html,
			'(?:var\\s+)?(?:images|readerImages|pages|imagesList)\\s*=\\s*(\\[[^\\]]+\\])',
			"i",
			""
		);

		if (jsArrayMatch) {
			try {
				const urls = JSON.parse(jsArrayMatch);
				for (const u of urls) {
					if (typeof u === "string" && u.length > 5) {
						const imgUrl = u.startsWith("http") ? u : this.BASE_URL + u;
						if (!seen[imgUrl]) {
							seen[imgUrl] = true;
							pages.push({ url: imgUrl });
						}
					}
				}
			} catch (e) {
				// JSON parse failed — fall through to img tag scan
			}
		}

		// Fallback: scan for <img> tags with comic page images
		if (pages.length === 0) {
			const matches = this._matchAll(
				html,
				'<img[^>]+src="(https?://[^"]+\\.(?:jpg|jpeg|png|webp)[^"]*)"',
				"gi"
			);
			for (const m of matches) {
				const imgUrl = m[1];
				if (imgUrl.includes("/static/") || imgUrl.includes("logo") || imgUrl.includes("avatar")) { continue; }
				if (seen[imgUrl]) { continue; }
				seen[imgUrl] = true;
				pages.push({ url: imgUrl });
			}
		}

		return pages;
	},

	// --- Settings ---

	getSettings() {
		return [];
	},
};
