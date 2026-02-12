
import Article from './article';
import Bestof from './bestof';
import Comparison from './comparison';
import Guide from './guide';
import Landing from './landing';
import Location from './location';
import Post from './post';
import Review from './review';
import Service from './service';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const templateMap: Record<string, any> = {
  article: Article,
  guide: Guide,
  review: Review,
  comparison: Comparison,
  bestof: Bestof,
  service: Service,
  location: Location,
  post: Post,
  landing: Landing
};
