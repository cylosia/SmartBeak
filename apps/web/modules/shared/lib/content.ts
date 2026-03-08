import slugify from "@sindresorhus/slugify";

export type ContentStructureItem = {
	label: string;
	path: string;
	children: ContentStructureItem[];
	isPage: boolean;
};

function compareLocalePreference(
	currentLocale: string,
	existingLocale: string,
	preferredLocale: string | undefined,
) {
	const currentMatches = currentLocale === preferredLocale;
	const existingMatches = existingLocale === preferredLocale;
	if (currentMatches === existingMatches) {
		return 0;
	}
	return currentMatches ? 1 : -1;
}

export function getContentStructure({
	documents,
	meta,
	locale,
}: {
	documents: {
		path: string;
		locale: string;
		title: string;
	}[];
	meta: {
		path: string;
		locale: string;
		data: Record<string, string | { title: string }>;
	}[];
	locale?: string;
}) {
	const contentStructure: ContentStructureItem[] = [];
	const preferredDocumentsByPath = new Map<
		string,
		(typeof documents)[number]
	>();
	for (const document of documents) {
		const existing = preferredDocumentsByPath.get(document.path);
		if (
			!existing ||
			compareLocalePreference(document.locale, existing.locale, locale) > 0
		) {
			preferredDocumentsByPath.set(document.path, document);
		}
	}

	const preferredMetaByPath = new Map<string, (typeof meta)[number]>();
	for (const metaEntry of meta) {
		const existing = preferredMetaByPath.get(metaEntry.path);
		if (
			!existing ||
			compareLocalePreference(metaEntry.locale, existing.locale, locale) > 0
		) {
			preferredMetaByPath.set(metaEntry.path, metaEntry);
		}
	}

	const metaOrderByPath = new Map<string, Map<string, number>>();
	for (const [path, metaEntry] of preferredMetaByPath.entries()) {
		metaOrderByPath.set(
			path,
			new Map(Object.keys(metaEntry.data).map((key, index) => [key, index])),
		);
	}

	function addToContentItemArray(
		contentItemsArray: ContentStructureItem[],
		subPath: string,
		item: (typeof documents)[number],
	) {
		const escapedSubPath = subPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pathParts = item.path
			.replace(new RegExp(`^${escapedSubPath}[/]*`), "")
			.split("/");

		const rootItemPath = subPath
			? [subPath, pathParts[0]].join("/")
			: pathParts[0];

		let rootItem = contentItemsArray.find(
			(contentItem) => contentItem.path === rootItemPath,
		);

		const isPage = pathParts.length === 1;
		if (!rootItem) {
			const path = isPage ? item.path : rootItemPath;
			const metaData = preferredMetaByPath.get(subPath)?.data[pathParts[0]];
			const label = metaData
				? typeof metaData === "string"
					? metaData
					: metaData.title
				: (preferredDocumentsByPath.get(rootItemPath)?.title ??
					pathParts[0]);

			rootItem = {
				label,
				path,
				children: [],
				isPage,
			};

			contentItemsArray.push(rootItem);
		}

		if (isPage && !rootItem.isPage) {
			rootItem.isPage = true;
		}

		if (pathParts.length > 1) {
			addToContentItemArray(rootItem.children, rootItemPath, item);
		}
	}

	documents.forEach((page) => {
		addToContentItemArray(contentStructure, "", page);
	});

	// recursively sort items and their children
	function sortContentItems(items: ContentStructureItem[], basePath = "") {
		const orderMap = metaOrderByPath.get(basePath);
		items.sort((a, b) => {
			if (a.path === "") {
				return -1;
			}
			if (b.path === "") {
				return 1;
			}

			const aIndex =
				orderMap?.get(a.path.replace(`${basePath}/`, "")) ?? items.length;
			const bIndex =
				orderMap?.get(b.path.replace(`${basePath}/`, "")) ?? items.length;

			// use position index from meta file or put the item at the end of the list
			return aIndex - bIndex;
		});

		items.forEach((item) => {
			if (item.children.length) {
				sortContentItems(item.children, item.path);
			}
		});
	}

	sortContentItems(contentStructure);

	return contentStructure;
}

export function getActivePathFromUrlParam(path: string | string[]) {
	return Array.isArray(path) ? path.join("/") : path || "";
}

export function getLocalizedDocumentWithFallback<
	T extends { path: string; locale: string },
>(documents: T[], path: string, locale: string) {
	let preferredMatch: T | undefined;
	for (const document of documents) {
		if (document.path !== path) {
			continue;
		}
		if (
			!preferredMatch ||
			compareLocalePreference(
				document.locale,
				preferredMatch.locale,
				locale,
			) > 0
		) {
			preferredMatch = document;
		}
	}
	return preferredMatch;
}

export function slugifyHeadline(headline: string) {
	return slugify(headline, {
		lowercase: true,
		separator: "-",
	});
}
