/**
* Intent with image attachment
*/
export interface IntentWithImage {
  id?: string;
  title?: string;
  image?: string;
  [key: string]: unknown;
}

/**
* Attach an image to an intent
* @param intent - Intent object
* @param imageUrl - Image URL to attach
* @returns Intent with attached image
*/
export function attachImage(intent: IntentWithImage, imageUrl: string): IntentWithImage {
  return { ...intent, image: imageUrl };
}
