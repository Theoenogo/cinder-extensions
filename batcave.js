// BatCave Extension for Cinder
// Western comics from BatCave.biz

const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const BROWSER_HEADERS = {
	"User-Agent": DESKTOP_UA,
	"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
	"Referer": "https://batcave.biz/",
};

__cinderExport = {
	id: "batcave",
	name: "BatCave",
	version: "1.0.3",
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

	_absoluteUrl(url) {
		if (!url) { return undefined; }
		if (url.startsWith("data:")) { return undefined; }
		if (url.startsWith("http")) { return url; }
		return this.BASE_URL + url;
	},

	// --- Search ---

	async search(query, page = 1) {
		// Try GET first — /search/{query} is the canonical search URL
		let url = this.BASE_URL + "/search/" + encodeURIComponent(query);
		if (page > 1) { url += "/page/" + page + "/"; }

		const res = await cinder.fetch(url, { headers: BROWSER_HEADERS });

		// Surface the HTTP status so we can diagnose failures
		if (res.status !== 200) {
			throw new Error("BatCave search HTTP " + res.status + " — site may be blocking requests");
		}

		// Check if we got a Cloudflare challenge page instead of real content
		if (res.data && res.data.indexOf("readed__title") === -1) {
			// Try POST fallback — same as the site's quicksearch form
			const postRes = await cinder.fetch(this.BASE_URL + "/", {
				method: "POST",
				headers: Object.assign({}, BROWSER_HEADERS, {
					"Content-Type": "application/x-www-form-urlencoded",
				}),
				body: "do=search&subaction=search&story=" + encodeURIComponent(query),
			});

			if (postRes.status === 200 && postRes.data && postRes.data.indexOf("readed__title") !== -1) {
				return this._parseSeriesCards(postRes.data);
			}

			throw new Error("BatCave returned no results — got HTTP " + res.status + ", response length: " + (res.data ? res.data.length : 0));
		}

		return this._parseSeriesCards(res.data);
	},

	// --- Discover ---

	async getDiscoverSections() {
		return [
			{ id: "latest",  title: "Latest",   icon: "🆕" },
			{ id: "popular", title: "Popular",   icon: "🔥" },
			{ id: "dc",      title: "DC Comics", icon: "🦇" },
			{ id: "marvel",  title: "Marvel",    icon: "🕷️" },
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
	// Structure: <h2 class="readed__title"><a href="https://batcave.biz/ID-slug.html">Title</a></h2>
	// Covers use data-src (lazy loaded), located before the <h2> in the DOM.
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

			// Cover is in the <a class="readed__img"> before the <h2>
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

		const rawCover =
			this._match(html, 'data-src="(/uploads/[^"]+)"', "i", "");
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
			'href="/reader/' + numericSeriesId + '/(\\d+)"[^>]*>([\\s\\S]*?)<\\/a>',
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

		// DLE readers typically store images in a JS array
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
				// fall through to img scan
			}
		}

		if (pages.length === 0) {
			const matches = this._matchAll(
				html,
				'<img[^>]+(?:src|data-src)="(https?://[^"]+\\.(?:jpg|jpeg|png|webp)[^"]*)"',
				"gi"
			);
			for (const m of matches) {
				const imgUrl = m[1];
				if (imgUrl.includes("/static/") || imgUrl.includes("logo") ||
				    imgUrl.includes("avatar") || imgUrl.includes("mini/")) { continue; }
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
