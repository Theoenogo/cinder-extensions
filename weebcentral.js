// ─── WeebCentral Extension for Cinder ───────────────────────
//
// Searches and browses manga/manhwa/manhua from WeebCentral.com
// Uses HTML scraping since WeebCentral has no public JSON API.
//
// URL patterns:
//   Search:        https://weebcentral.com/search?text={query}&limit=20&official=Any&display_mode=Minimal%20Display&sort=Best+Match&order=Ascending&status=Any&type=Any
//   Series:        https://weebcentral.com/series/{ULID}
//   Chapter list:  https://weebcentral.com/series/{ULID}/full-chapter-list
//   Chapter:       https://weebcentral.com/chapters/{ULID}

__cinderExport = {
	id: "weebcentral",
	name: "WeebCentral",
	version: "1.0.0",
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

	// Extract all regex matches with a capture group from a string
	_matchAll(html, regex) {
		const results = [];
		let match;
		const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
		while ((match = re.exec(html)) !== null) {
			results.push(match);
		}
		return results;
	},

	// Extract the first match of a capture group, or a fallback
	_match(html, regex, fallback = "") {
		const m = regex.exec(html);
		return m ? m[1].trim() : fallback;
	},

	// Decode common HTML entities
	_decode(str) {
		return str
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&apos;/g, "'")
			.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
	},

	// Strip all HTML tags from a string
	_stripTags(str) {
		return str.replace(/<[^>]*>/g, "").trim();
	},

	// Extract series ULID from a /series/ URL
	_seriesIdFromUrl(url) {
		const m = /\/series\/([A-Z0-9]+)/i.exec(url);
		return m ? m[1] : null;
	},

	// Extract chapter ULID from a /chapters/ URL
	_chapterIdFromUrl(url) {
		const m = /\/chapters\/([A-Z0-9]+)/i.exec(url);
		return m ? m[1] : null;
	},

	// ── Search ───────────────────────────────────────────────

	async search(query, page = 1) {
		const limit = 20;
		const offset = (Math.max(1, page) - 1) * limit;

		const url =
			`${this.BASE_URL}/search?text=${encodeURIComponent(query)}` +
			`&limit=${limit}&offset=${offset}` +
			`&official=Any&display_mode=Minimal%20Display` +
			`&sort=Best+Match&order=Ascending&status=Any&type=Any`;

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" },
		});

		if (res.status !== 200) {
			cinder.error("WeebCentral search failed:", res.status);
			return [];
		}

		return this._parseSearchResults(res.data);
	},

	_parseSearchResults(html) {
		const results = [];

		// Each series card is an <a> element linking to /series/{ID}
		// Pattern: <a ... href="/series/ULID/slug-title" ...>...<img ... src="cover_url">...<span ...>Title</span>
		const cardRegex = /<a[^>]+href="(\/series\/[A-Z0-9]+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
		const cards = this._matchAll(html, cardRegex);

		for (const card of cards) {
			const [, href, inner] = card;

			// Skip non-series links (navigation etc.)
			if (!/\/series\/[A-Z0-9]{20,}/i.test(href)) continue;

			const id = this._seriesIdFromUrl(href);
			if (!id) continue;

			// Cover image
			const coverMatch = /src="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/.exec(inner);
			const cover = coverMatch ? coverMatch[1] : undefined;

			// Title — try <span> or alt text
			const titleFromSpan = this._match(inner, /<span[^>]*>\s*([^<]{2,})\s*<\/span>/i);
			const titleFromAlt = this._match(inner, /alt="([^"]+)"/i);
			const title = this._decode(titleFromSpan || titleFromAlt || "Unknown Title");

			if (title === "Unknown Title" && !cover) continue;

			results.push({
				id,
				title,
				cover,
				url: `${this.BASE_URL}/series/${id}`,
				format: "manga",
			});
		}

		return results;
	},

	// ── Discover ─────────────────────────────────────────────

	async getDiscoverSections() {
		return [
			{ id: "hot-weekly",   title: "Hot This Week",  icon: "🔥" },
			{ id: "hot-monthly",  title: "Hot This Month", icon: "📈" },
			{ id: "hot-alltime",  title: "All-Time Popular", icon: "⭐" },
			{ id: "latest",       title: "Latest Updates", icon: "🆕" },
		];
	},

	async getDiscoverItems(sectionId, page = 0) {
		const limit = 20;
		const offset = page * limit;

		let url;
		if (sectionId === "latest") {
			url =
				`${this.BASE_URL}/search?text=` +
				`&limit=${limit}&offset=${offset}` +
				`&official=Any&display_mode=Minimal%20Display` +
				`&sort=Latest+Updates&order=Descending&status=Any&type=Any`;
		} else {
			// WeebCentral has a /series/trending page that returns weekly/monthly/all-time
			const period =
				sectionId === "hot-weekly"  ? "weekly"  :
				sectionId === "hot-monthly" ? "monthly" : "all_time";
			url = `${this.BASE_URL}/series/trending?period=${period}&limit=${limit}&offset=${offset}`;
		}

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" },
		});

		if (res.status !== 200) return [];
		return this._parseSearchResults(res.data);
	},

	// ── Manga Details ─────────────────────────────────────────

	async getMangaDetails(id) {
		const url = `${this.BASE_URL}/series/${id}`;

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" },
		});

		if (res.status !== 200) throw new Error(`Failed to fetch series page: ${res.status}`);

		const html = res.data;

		// Title — usually in <h1> or <title>
		const title = this._decode(
			this._match(html, /<h1[^>]*>\s*([^<]+)\s*<\/h1>/i) ||
			this._match(html, /<title>\s*([^|<]+?)(?:\s*[|–-].*)?<\/title>/i) ||
			"Unknown"
		);

		// Cover image
		const cover = this._match(html, /<img[^>]+id="[^"]*cover[^"]*"[^>]+src="([^"]+)"/i) ||
		              this._match(html, /<img[^>]+class="[^"]*cover[^"]*"[^>]+src="([^"]+)"/i) ||
		              this._match(html, /src="(https:\/\/[^"]+(?:cover|thumb)[^"]*(?:jpg|jpeg|png|webp))"/i);

		// Description
		const descRaw = this._match(html, /<p[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
		                this._match(html, /<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
		const description = descRaw ? this._decode(this._stripTags(descRaw)) : "";

		// Status
		const status = this._match(html, /(?:Status|Ongoing|Completed)[^>]*>\s*<[^>]+>\s*([^<]+)/i);

		// Author
		const author = this._decode(
			this._match(html, /(?:Author|Authors?)[^>]*>\s*(?:<[^>]+>)?\s*([^<]{2,})/i)
		);

		// Genres — extract all <a> tags inside a genres/tags container
		const genreBlock = this._match(html, /(?:Genres?|Tags?)[^>]*>([\s\S]*?)(?:<\/(?:div|ul|section)>)/i);
		const genres = genreBlock
			? this._matchAll(genreBlock, /<a[^>]*>([^<]+)<\/a>/i).map(m => this._decode(m[1].trim()))
			: [];

		return {
			id,
			title,
			cover: cover || undefined,
			description,
			author: author || undefined,
			status: status ? status.toLowerCase().trim() : undefined,
			genres,
		};
	},

	// ── Chapters ─────────────────────────────────────────────

	async getChapters(seriesId) {
		// WeebCentral provides a dedicated full chapter list endpoint
		const url = `${this.BASE_URL}/series/${seriesId}/full-chapter-list`;

		const res = await cinder.fetch(url, {
			headers: {
				"User-Agent": "CinderApp/2.0 (iOS; Cinder)",
				// The full-chapter-list endpoint may be an HTMX partial — hint that we accept HTML
				"Accept": "text/html, */*",
			},
		});

		if (res.status !== 200) throw new Error(`Failed to fetch chapter list: ${res.status}`);

		return this._parseChapterList(res.data, seriesId);
	},

	_parseChapterList(html, seriesId) {
		const chapters = [];

		// Each chapter row: <a href="/chapters/{ULID}" ...>
		const rowRegex = /<a[^>]+href="(\/chapters\/[A-Z0-9]+)"[^>]*>([\s\S]*?)<\/a>/gi;
		const rows = this._matchAll(html, rowRegex);

		for (const row of rows) {
			const [, href, inner] = row;

			const chapterId = this._chapterIdFromUrl(href);
			if (!chapterId) continue;

			// Chapter number — look for patterns like "Chapter 42" or just "42" or "42.5"
			const numStr =
				this._match(inner, /Chapter\s+([\d.]+)/i) ||
				this._match(inner, /Ch\.?\s*([\d.]+)/i) ||
				this._match(inner, />([\d.]+)<\//) ||
				"0";
			const chapterNumber = parseFloat(numStr) || 0;

			// Title — may include a named chapter title after the number
			const rawTitle = this._decode(this._stripTags(inner)).replace(/\s+/g, " ").trim();
			const title = rawTitle || `Chapter ${numStr}`;

			// Upload date — ISO date strings like 2024-01-15
			const dateStr = this._match(inner, /(\d{4}-\d{2}-\d{2})/);

			chapters.push({
				id: chapterId,
				title,
				chapterNumber,
				dateUploaded: dateStr || undefined,
			});
		}

		// WeebCentral lists chapters newest-first; reverse so chapterNumber ascends
		return chapters.reverse();
	},

	// ── Pages ─────────────────────────────────────────────────

	async getPages(chapterId) {
		const url = `${this.BASE_URL}/chapters/${chapterId}`;

		const res = await cinder.fetch(url, {
			headers: { "User-Agent": "CinderApp/2.0 (iOS; Cinder)" },
		});

		if (res.status !== 200) throw new Error(`Failed to fetch chapter: ${res.status}`);

		return this._parsePages(res.data);
	},

	_parsePages(html) {
		const pages = [];
		const seen = new Set();

		// WeebCentral renders chapter images as <img> tags.
		// They are typically served from a CDN like images.weebcentral.com
		// Look for <img> tags inside the chapter reader container.
		const imgRegex = /<img[^>]+src="(https:\/\/(?:images\.weebcentral\.com|cdn\.[^"]+)[^"]+(?:jpg|jpeg|png|webp)[^"]*)"/gi;
		const matches = this._matchAll(html, imgRegex);

		for (const m of matches) {
			const imgUrl = m[1];
			if (seen.has(imgUrl)) continue;
			seen.add(imgUrl);
			pages.push({ url: imgUrl });
		}

		// Fallback: try data-src (lazy-loaded images)
		if (pages.length === 0) {
			const lazySrcRegex = /<img[^>]+data-src="(https:\/\/[^"]+(?:jpg|jpeg|png|webp)[^"]*)"/gi;
			const lazyMatches = this._matchAll(html, lazySrcRegex);
			for (const m of lazyMatches) {
				const imgUrl = m[1];
				if (seen.has(imgUrl)) continue;
				seen.add(imgUrl);
				pages.push({ url: imgUrl });
			}
		}

		return pages;
	},

	// ── Settings ─────────────────────────────────────────────

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
			{
				id: "sort_order",
				label: "Default Sort",
				type: "select",
				defaultValue: "Best Match",
				options: [
					{ label: "Best Match",     value: "Best+Match"    },
					{ label: "Latest Updates", value: "Latest+Updates" },
					{ label: "Oldest",         value: "Oldest"        },
					{ label: "Most Popular",   value: "Most+Popular"  },
				],
			},
		];
	},
};
