// BatCave Extension for Cinder
// Western comics from BatCave.biz

const IOS_SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const BROWSER_HEADERS = {
	"User-Agent": IOS_SAFARI_UA,
	"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
};

__cinderExport = {
	id: "batcave",
	name: "BatCave",
	version: "1.0.6",
	icon: "🦇",
	description: "Read western comics from BatCave.biz",
	contentType: "comic",

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

	_numericId(slug) {
		const m = /^(\d+)/.exec(slug);
		return m ? m[1] : slug;
	},

	// --- Search ---

	async search(query, page = 1) {
		let url = this.BASE_URL + "/search/" + encodeURIComponent(query);
		if (page > 1) { url += "/page/" + page + "/"; }

		let status1 = 0;
		let len1 = 0;

		try {
			const res = await cinder.fetch(url, { headers: BROWSER_HEADERS });
			status1 = res.status;
			len1 = res.data ? res.data.length : 0;

			if (res.status === 200 && res.data && res.data.indexOf("readed__title") !== -1) {
				return this._parseSeriesCards(res.data);
			}
		} catch (e) {
			status1 = -1;
		}

		// Second attempt: no custom headers at all (Cinder defaults)
		let status2 = 0;
		let len2 = 0;

		try {
			const res2 = await cinder.fetch(url, {});
			status2 = res2.status;
			len2 = res2.data ? res2.data.length : 0;

			if (res2.status === 200 && res2.data && res2.data.indexOf("readed__title") !== -1) {
				return this._parseSeriesCards(res2.data);
			}
		} catch (e) {
			status2 = -1;
		}

		// Both failed — return diagnostics as a visible pseudo-result
		return [{
			id: "debug-info",
			title: "DEBUG ios:" + status1 + "/" + len1 + " default:" + status2 + "/" + len2,
			cover: undefined,
			url: this.BASE_URL,
			format: "comic",
		}];
	},

	// --- Discover ---

	async getDiscoverSections() {
		return [
			{ id: "latest",  title: "Latest",   icon: "🆕" },
			{ id: "popular", title: "Popular",   icon: "🔥" },
			{ id: "dc",      title: "DC Comics", icon: "🦇" },
			{ id: "marvel",  title: "Marvel",    icon: "🕷" },
		];
	},

	async getDiscoverItems(sectionId, page = 0) {
		const p = page + 1;
		let url;

		if (sectionId === "latest") {
			url = this.BASE_URL + "/comix/page/" + p + "/";
		} else if (sectionId === "popular") {
			url = this.BASE_URL + "/comix/page/" + p + "/?sort=rating&order=desc";
		} else if (sectionId === "dc") {
			url = this.BASE_URL + "/tags/dc-comics/page/" + p + "/";
		} else {
			url = this.BASE_URL + "/tags/marvel/page/" + p + "/";
		}

		const res = await cinder.fetch(url, { headers: BROWSER_HEADERS });
		if (res.status !== 200) { return []; }
		return this._parseSeriesCards(res.data);
	},

	// Parse search/listing result cards.
	// <h2 class="readed__title"><a href="https://batcave.biz/ID-slug.html">Title</a></h2>
	// Covers are lazy-loaded via data-src, appearing before the h2.
	_parseSeriesCards(html) {
		const results = [];
		const seen = {};

		const titleMatches = this._matchAll(
			html,
			'<h2[^>]*class="[^"]*readed__title[^"]*"[^>]*>\\s*<a[^>]+href="https://batcave\\.biz/(\\d+-[^"]+)\\.html"[^>]*>([^<]+)<\\/a>',
			"gi"
		);

		for (const m of titleMatches) {
			const slug = m[1];
			const title = this._decode(m[2].trim());
			if (!slug || !title || seen[slug]) { continue; }
			seen[slug] = true;

			const pos = html.indexOf(m[0]);
			const lookback = html.substring(Math.max(0, pos - 600), pos);
			const rawCover = this._match(lookback, 'data-src="(/uploads/[^"]+)"', "i", "");
			const cover = rawCover ? this.BASE_URL + rawCover : undefined;

			results.push({
				id: slug,
				title: title,
				cover: cover,
				url: this.BASE_URL + "/" + slug + ".html",
				format: "comic",
			});
		}

		return results;
	},

	// --- Series Details ---

	async getMangaDetails(id) {
		const url = this.BASE_URL + "/" + id + ".html";

		const res = await cinder.fetch(url, { headers: BROWSER_HEADERS });
		if (res.status !== 200) {
			throw new Error("Failed to fetch series: " + res.status);
		}

		const html = res.data;

		const title = this._decode(
			this._match(html, '<h1[^>]*>\\s*([^<]+?)\\s*<\\/h1>', "i", "Unknown")
		);

		const rawCover = this._match(html, 'data-src="(/uploads/[^"]+)"', "i", "");
		const cover = rawCover ? this.BASE_URL + rawCover : undefined;

		const descRaw =
			this._match(html, '<div[^>]*class="[^"]*description[^"]*"[^>]*>([\\s\\S]*?)<\\/div>', "i", "") ||
			this._match(html, '<div[^>]*class="[^"]*summary[^"]*"[^>]*>([\\s\\S]*?)<\\/div>', "i", "");
		const description = descRaw ? this._decode(this._stripTags(descRaw)) : "";

		return {
			id: id,
			title: title,
			cover: cover,
			description: description,
		};
	},

	// --- Chapters ---

	async getChapters(seriesId) {
		const url = this.BASE_URL + "/" + seriesId + ".html";

		const res = await cinder.fetch(url, { headers: BROWSER_HEADERS });
		if (res.status !== 200) {
			throw new Error("Failed to fetch series page: " + res.status);
		}

		return this._parseChapterList(res.data, seriesId);
	},

	_parseChapterList(html, seriesSlug) {
		const chapters = [];
		const numericSeriesId = this._numericId(seriesSlug);

		const rows = this._matchAll(
			html,
			'href="(?:https://batcave\\.biz)?/reader/' + numericSeriesId + '/(\\d+)[^"]*"[^>]*>([\\s\\S]*?)<\\/a>',
			"gi"
		);

		for (const row of rows) {
			const chapterId = row[1];
			const inner = row[2];
			const rawText = this._decode(this._stripTags(inner)).replace(/\s+/g, " ").trim();

			const numStr =
				this._match(inner, '#([\\d.]+)', "i", "") ||
				this._match(inner, 'Issue\\s+([\\d.]+)', "i", "") ||
				this._match(inner, 'Chapter\\s+([\\d.]+)', "i", "") ||
				this._match(rawText, '([\\d.]+)', "i", "0");

			const chapterNumber = parseFloat(numStr) || 0;

			chapters.push({
				id: numericSeriesId + "/" + chapterId,
				title: rawText || ("#" + numStr),
				chapterNumber: chapterNumber,
			});
		}

		chapters.reverse();
		return chapters;
	},

	// --- Pages ---

	async getPages(chapterId) {
		const url = this.BASE_URL + "/reader/" + chapterId;

		const res = await cinder.fetch(url, { headers: BROWSER_HEADERS });
		if (res.status !== 200) {
			throw new Error("Failed to fetch reader: " + res.status);
		}

		return this._parsePages(res.data);
	},

	_parsePages(html) {
		const pages = [];
		const seen = {};

		// Try to find image arrays in page JS (DLE/Vue readers)
		const jsArrayMatch = this._match(
			html,
			'"images"\\s*:\\s*(\\[[^\\]]+\\])',
			"i",
			""
		) || this._match(
			html,
			'(?:var\\s+)?(?:images|readerImages|pages|imagesList|imgs)\\s*=\\s*(\\[[^\\]]+\\])',
			"i",
			""
		);

		if (jsArrayMatch) {
			const rawImgs = this._matchAll(jsArrayMatch, '"([^"]+\\.(?:jpg|jpeg|png|webp)[^"]*)"', "gi");
			for (const m of rawImgs) {
				const u = m[1].replace(/\\\//g, "/");
				const imgUrl = u.startsWith("http") ? u : this.BASE_URL + u;
				if (!seen[imgUrl]) {
					seen[imgUrl] = true;
					pages.push({ url: imgUrl });
				}
			}
		}

		// Fallback: img tags
		if (pages.length === 0) {
			const matches = this._matchAll(
				html,
				'<img[^>]+(?:src|data-src)="((?:https?://[^"]+|/uploads/[^"]+)\\.(?:jpg|jpeg|png|webp)[^"]*)"',
				"gi"
			);
			for (const m of matches) {
				const u = m[1];
				const imgUrl = u.startsWith("http") ? u : this.BASE_URL + u;
				if (imgUrl.includes("/static/") || imgUrl.includes("logo") ||
				    imgUrl.includes("avatar") || imgUrl.includes("mini/") ||
				    imgUrl.includes("noavatar") || imgUrl.includes("fotos/")) { continue; }
				if (seen[imgUrl]) { continue; }
				seen[imgUrl] = true;
				pages.push({ url: imgUrl });
			}
		}

		return pages;
	},

	getSettings() {
		return [];
	},
};
