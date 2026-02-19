
import Article from './article';
import Bestof from './bestof';
import Category from './category';
import Comparison from './comparison';
import Guide from './guide';
import Landing from './landing';
import Location from './location';
import Post from './post';
import Review from './review';
import Service from './service';
import Tag from './tag';

export {
  Article as ArticleTemplate,
  Bestof as BestOfTemplate,
  Category as CategoryTemplate,
  Comparison as ComparisonTemplate,
  Guide as GuideTemplate,
  Landing as LandingTemplate,
  Location as LocationTemplate,
  Post as PostTemplate,
  Review as ReviewTemplate,
  Service as ServiceTemplate,
  Tag as TagTemplate,
};

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
  landing: Landing,
  category: Category,
  tag: Tag,
};

export default {
  ArticleTemplate: Article,
  BestOfTemplate: Bestof,
  CategoryTemplate: Category,
  ComparisonTemplate: Comparison,
  GuideTemplate: Guide,
  LandingTemplate: Landing,
  LocationTemplate: Location,
  PostTemplate: Post,
  ReviewTemplate: Review,
  ServiceTemplate: Service,
  TagTemplate: Tag,
};
