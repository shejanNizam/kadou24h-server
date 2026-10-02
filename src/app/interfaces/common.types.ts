// GeoJSON point — coordinates are [longitude, latitude]
export interface IGeoPoint {
  type: "Point";
  coordinates: [number, number];
}

// A file stored on Cloudinary (returned by POST /upload)
export interface IFileRef {
  url: string;
  publicId: string;
}

// What the API accepts / returns instead of raw GeoJSON
export interface ILatLng {
  lat: number;
  lng: number;
}
