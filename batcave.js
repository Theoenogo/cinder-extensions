// BatCave Extension for Cinder
// Western comics from BatCave.biz
//
// URL patterns:
//   Search:      https://batcave.biz/search/{query}
//   Series page: https://batcave.biz/{id}-{slug}.html
//   Reader:      https://batcave.biz/reader/{series_id}/{chapter_id}
//   Browse:      https://batcave.biz/comix/page/{n}/

// Mobile UA required — series pages return 401 without it
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

__cinderExport = {
	id: "batcave",
	name: "BatCave",
	version: "1.0.1",
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

	// Series ID is the full slug WITHOUT .html, e.g. "30310-batman-some-title"
	// This lets us reconstruct the URL directly without a secondary search.
	// Numeric series ID (for reader URLs) is just the leading digits.
	_numericId(slug) {
		const m = /^(\d+)/.exec(slug);
		return m ? m[1] : slug;
	},

	// --- Search ---

	async search(query, page = 1) {
		// Search URL: https://batcave.biz/search/{query}
		// Pagination guess: https://batcave.biz/search/{query}/page/{n}/
		let url = this.BASE_URL + "/search/" + encodeURIComponent(query);
		if (page > 1) { url += "/page/" + page + "/"; }

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

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": MOBILE_UA }
		});

		if (res.status !== 200) { return []; }
		return this._parseSeriesCards(res.data);
	},

	// Parse series cards from any listing or search page
	_parseSeriesCards(html) {
		const results = [];
		const seen = {};

		// Match links: href="https://batcave.biz/30310-some-slug.html"
		const links = this._matchAll(
			html,
			'href="https://batcave\\.biz/(\\d+-[^"]+)\\.html"',
			"gi"
		);

		for (const link of links) {
			const slug = link[1]; // e.g. "30310-batman-the-dark-knight"
			if (seen[slug]) { continue; }
			seen[slug] = true;

			const pos = html.indexOf(link[0]);
			const chunk = html.substring(Math.max(0, pos - 300), pos + 800);

			// Cover image
			const cover = this._match(chunk, '<img[^>]+src="([^"]+)"', "i", "");

			// Title — try alt text first, then headings
			const title = this._decode(
				this._match(chunk, '<img[^>]+alt="([^"]+)"', "i", "") ||
				this._match(chunk, '<h[1-4][^>]*>\\s*([^<]+?)\\s*<\\/h[1-4]>', "i", "") ||
				this._match(chunk, 'title="([^"]+)"', "i", "") ||
				""
			);

			if (!title) { continue; }

			results.push({
				id: slug,
				title: title.trim(),
				cover: cover || undefined,
				url: this.BASE_URL + "/" + slug + ".html",
				format: "comic",
			});
		}

		return results;
	},

	// --- Series Details ---

	async getMangaDetails(id) {
		// id = slug like "30310-batman-some-title"
		const url = this.BASE_URL + "/" + id + ".html";

		const res = await cinder.fetch(url, {
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
			this._match(html, '<div[^>]*class="[^"]*poster[^"]*"[^>]*>[\\s\\S]*?<img[^>]+src="([^"]+)"', "i", "") ||
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
		};
	},

	// --- Chapters ---

	async getChapters(seriesId) {
		// seriesId = slug like "30310-batman-some-title"
		const url = this.BASE_URL + "/" + seriesId + ".html";

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": MOBILE_UA }
		});

		if (res.status !== 200) {
			throw new Error("Failed to fetch series page: " + res.status);
		}

		return this._parseChapterList(res.data, seriesId);
	},

	_parseChapterList(html, seriesSlug) {
		const chapters = [];
		const numericSeriesId = this._numericId(seriesSlug);

		// Reader links: href="https://batcave.biz/reader/{numericId}/{chapterId}"
		const rows = this._matchAll(
			html,
			'href="https://batcave\\.biz/reader/' + numericSeriesId + '/(\\d+)"[^>]*>([\\s\\S]*?)<\\/a>',
			"gi"
		);

		for (const row of rows) {
			const chapterId = row[1];
			const inner = row[2];
			const rawText = this._decode(this._stripTags(inner)).replace(/\s+/g, " ").trim();

			// Try to extract issue/chapter number
			const numStr =
				this._match(inner, '#([\\d.]+)', "i", "") ||
				this._match(inner, 'Issue\\s+([\\d.]+)', "i", "") ||
				this._match(inner, 'Chapter\\s+([\\d.]+)', "i", "") ||
				this._match(rawText, '([\\d.]+)', "i", "0");

			const chapterNumber = parseFloat(numStr) || 0;

			// Store chapter ID as "numericSeriesId/chapterId" so getPages
			// can reconstruct the full reader URL without extra lookups
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
		// chapterId = "numericSeriesId/chapterId", e.g. "30310/74861"
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

		// DLE readers often store images in a JS array variable
		const jsArrayMatch = this._match(
			html,
			'(?:var\\s+)?(?:images|readerImages|pages|imagesList|imgs)\\s*=\\s*(\\[[^\\]]+\\])',
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
				// fall through to img tag scan
			}
		}

		// Fallback: scan for <img> tags
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
