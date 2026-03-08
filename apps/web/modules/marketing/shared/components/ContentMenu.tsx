import { LocaleLink } from "@i18n/routing";
import type { ContentStructureItem } from "@shared/lib/content";

function ContentMenuItem({
	label,
	path,
	isPage,
	children,
	activePath,
}: ContentStructureItem & { activePath: string }) {
	return (
		<li>
			{isPage ? (
				<LocaleLink
					className={`block rounded-full px-4 py-1 ${path === activePath ? "bg-primary/5 font-bold" : ""}`}
					href={`/docs/${path}`}
				>
					{label}
				</LocaleLink>
			) : (
				<span className="block px-4 py-1">
					{label}
				</span>
			)}

			{children && (
				<ul className="-mr-4 list-none space-y-2 pl-4">
					{children.map((subItem) => (
						<ContentMenuItem
							key={subItem.path}
							{...subItem}
							activePath={activePath}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

export function ContentMenu({
	items,
	activePath,
}: {
	items: ContentStructureItem[];
	activePath: string;
}) {
	return (
		<ul className="-mx-4 list-none space-y-2 pr-4">
			{items.map((item) => (
				<ContentMenuItem
					key={item.path}
					{...item}
					activePath={activePath}
				/>
			))}
		</ul>
	);
}
