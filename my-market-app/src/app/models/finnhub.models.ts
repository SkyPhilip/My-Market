export interface FinnhubNewsArticle {
  headline: string;
  summary: string;
  source: string;
  url: string;
  image?: string | null;
  datetime: number;
  related?: string | null;
}