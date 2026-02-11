
export interface FacebookRenderInput {
  title: string;
  excerpt?: string;
  url: string;
  imageUrl?: string;
}

export function renderFacebookPost(input: FacebookRenderInput) {
  const lines: string[] = [];
  if (input.title) lines.push(input.title);
  if (input.excerpt) lines.push(input.excerpt);
  if (input.url) lines.push(input.url);
  return {
  message: lines.join('\n\n'),
  link: input.url,
  image_url: input.imageUrl
  };
}
