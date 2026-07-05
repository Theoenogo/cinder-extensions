// BatCave Extension for Cinder
// Western comics from BatCave.biz
//
// v1.0.4 strategy notes:
// - Cinder runs on iOS, so its TLS fingerprint is iOS/URLSession.
//   Claiming to be desktop Chrome in the UA while having an iOS TLS
//   fingerprint is a classic bot signal for Cloudflare. This version
//   uses an honest iOS Safari UA (and a no-custom-headers attempt)
//   so the UA matches the TLS fingerprint.
// - If every fetch strategy fails, search returns a DEBUG pseudo-result
//   showing the HTTP status of each attempt, since Cinder does not
//   display thrown error messages.

const IOS_SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

__cinderExport = {
	id: "batcave",
	name: "BatCave",
	version: "1.0.4",
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

	// Multi-strategy fetch.
	// Tries, in order:
	//   1. No custom headers at all (Cinder's native defaults — UA matches TLS)
	//   2. iOS Safari UA (matches the device's TLS fingerprint)
	//   3. iOS Safari UA + Accept/Language/Referer
	// Returns { ok, data, attempts } where attempts is a debug string.
	async _smartFetch(url, validator) {
		const strategies = [
			{ name: "default", opts: {} },
			{ name: "ios-ua", opts: { headers: { "User-Agent": IOS_SAFARI_UA } } },
			{
				name: "ios-full",
				opts: {
					headers: {
						"User-Agent": IOS_SAFARI_UA,
						"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
						"Accept-Language": "en-US,en;q=0.9",
						"Referer": "https://batcave.biz/",
					}
				}
			},
		];

		const attempts = [];

		for (const s of strategies) {
			try {
				const res = await cinder.fetch(url, s.opts);
				const len = res.data ? res.data.length : 0;
				const valid = res.status === 200 && (!validator || validator(res.data));
				attempts.push(s.name + ":" + res.status + "/" + len + (valid ? "/OK" : ""));
				if (valid) {
					return { ok: true, data: res.data, attempts: attempts.join(" ") };
				}
			} catch (e) {
				attempts.push(s.name + ":ERR(" + (e && e.message ? e.message.substring(0, 40) : "?") + ")");
			}
		}

		return { ok: false, data: null, attempts: attempts.join(" ") };
	},

	// --- Search ---

	async search(query, page = 1) {
		let url = this.BASE_URL + "/search/" + encodeURIComponent(query);
		if (page > 1) { url += "/page/" + page + "/"; }

		// A valid search results page contains the readed__title class
		const result = await this._smartFetch(url, (html) => html && html.indexOf("readed__title") !== -1);

		if (result.ok) {
			return this._parseSeriesCards(result.data);
		}

		// GET failed on all strategies — try the site's POST quicksearch form
		try {
			const postRes = await cinder.fetch(this.BASE_URL + "/", {
				method: "POST",
				headers: {
					"User-Agent": IOS_SAFARI_UA,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: "do=search&subaction=search&story=" + encodeURIComponent(query),
			});
			if (postRes.status === 200 && postRes.data && postRes.data.indexOf("readed__title") !== -1) {
				return this._parseSeriesCards(postRes.data);
			}
			result.attempts += " POST:" + postRes.status + "/" + (postRes.data ? postRes.data.length : 0);
		} catch (e) {
			result.attempts += " POST:ERR";
		}

		// Everything failed. Surface diagnostics as a pseudo-result since
		// Cinder does not display thrown error messages.
		return [{
			id: "debug-info",
			title: "DEBUG: " + result.attempts,
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

		const result = await this._smartFetch(url, (html) => html && html.length > 5000);
		if (!result.ok) { return []; }
		return this._parseSeriesCards(result.data);
	},

	// Parse search/listing result cards.
	// <h2 class="readed__title"><a href="https://batcave.biz/ID-slug.html">Title</a></h2>
	// Covers are lazy-loaded via data-src, appearing before the h2.
	// Catalogue pages may use a different card layout, so we also
	// fall back to generic series-link extraction.
	_parseSeriesCards(html) {
		const results = [];
		const seen = {};

		// Primary: search result cards
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

		// Fallback: generic extraction for catalogue/tag pages with
		// different card markup (e.g. "popular" sidebar-style cards)
		if (results.length === 0) {
			const links = this._matchAll(
				html,
				'<a[^>]+href="https://batcave\\.biz/(\\d+-[^"]+)\\.html"[^>]*>([\\s\\S]{0,900}?)<\\/a>',
				"gi"
			);

			for (const link of links) {
				const slug = link[1];
				const inner = link[2];
				if (seen[slug]) { continue; }

				const title = this._decode(
					this._match(inner, 'alt="([^"]+)"', "i", "") ||
					this._match(inner, '<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<', "i", "") ||
					this._stripTags(inner).substring(0, 80).trim()
				);

				if (!title || title.length < 2) { continue; }
				seen[slug] = true;

				const rawCover = this._match(inner, 'data-src="(/uploads/[^"]+)"', "i", "");
				const cover = rawCover ? this.BASE_URL + rawCover : undefined;

				results.push({
					id: slug,
					title: title,
					cover: cover,
					url: this.BASE_URL + "/" + slug + ".html",
					format: "comic",
				});
			}
		}

		return results;
	},

	// --- Series Details ---

	async getMangaDetails(id) {
		const url = this.BASE_URL + "/" + id + ".html";

		const result = await this._smartFetch(url, (html) => html && html.indexOf("<h1") !== -1);
		if (!result.ok) {
			throw new Error("Failed to fetch series page (" + result.attempts + ")");
		}

		const html = result.data;

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

		const result = await this._smartFetch(url, (html) => html && html.indexOf("/reader/") !== -1);
		if (!result.ok) {
			throw new Error("Failed to fetch chapters (" + result.attempts + ")");
		}

		return this._parseChapterList(result.data, seriesId);
	},

	_parseChapterList(html, seriesSlug) {
		const chapters = [];
		const numericSeriesId = this._numericId(seriesSlug);

		// Match both relative and absolute reader links, and skip "/first"
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

		const result = await this._smartFetch(url, (html) => html && html.length > 3000);
		if (!result.ok) {
			throw new Error("Failed to fetch reader (" + result.attempts + ")");
		}

		return this._parsePages(result.data);
	},

	_parsePages(html) {
		const pages = [];
		const seen = {};

		// Reader is a Vue app with data in window.__DATA__ — try that first
		// e.g. window.__DATA__ = {...,"images":["/uploads/...","..."],...}
		const dataBlock = this._match(html, 'window\\.__DATA__\\s*=\\s*(\\{[\\s\\S]*?\\});?\\s*<\\/script>', "i", "") ||
		                  this._match(html, 'window\\.__DATA__\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*[;\\n]', "i", "");

		if (dataBlock) {
			try {
				const data = JSON.parse(dataBlock);
				const imgs = data.images || (data.chapter && data.chapter.images) || [];
				for (const u of imgs) {
					if (typeof u === "string" && u.length > 5) {
						const imgUrl = u.startsWith("http") ? u : this.BASE_URL + u;
						if (!seen[imgUrl]) {
							seen[imgUrl] = true;
							pages.push({ url: imgUrl });
						}
					}
				}
			} catch (e) {
				// JSON parse failed — extract image paths from the raw block instead
				const rawImgs = this._matchAll(dataBlock, '"(\\/uploads\\/[^"]+\\.(?:jpg|jpeg|png|webp)[^"]*)"', "gi");
				for (const m of rawImgs) {
					const imgUrl = this.BASE_URL + m[1].replace(/\\\//g, "/");
					if (!seen[imgUrl]) {
						seen[imgUrl] = true;
						pages.push({ url: imgUrl });
					}
				}
			}
		}

		// Fallback 1: any JS array of images
		if (pages.length === 0) {
			const jsArrayMatch = this._match(
				html,
				'(?:var\\s+)?(?:images|readerImages|pages|imagesList|imgs)\\s*[=:]\\s*(\\[[^\\]]+\\])',
				"i",
				""
			);
			if (jsArrayMatch) {
				const rawImgs = this._matchAll(jsArrayMatch, '"([^"]+\\.(?:jpg|jpeg|png|webp)[^"]*)"', "gi");
				for (const m of rawImgs) {
					let u = m[1].replace(/\\\//g, "/");
					const imgUrl = u.startsWith("http") ? u : this.BASE_URL + u;
					if (!seen[imgUrl]) {
						seen[imgUrl] = true;
						pages.push({ url: imgUrl });
					}
				}
			}
		}

		// Fallback 2: img tags
		if (pages.length === 0) {
			const matches = this._matchAll(
				html,
				'<img[^>]+(?:src|data-src)="((?:https?://[^"]+|/uploads/[^"]+)\\.(?:jpg|jpeg|png|webp)[^"]*)"',
				"gi"
			);
			for (const m of matches) {
				let u = m[1];
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
