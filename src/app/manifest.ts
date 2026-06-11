import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GetDone',
    short_name: 'GetDone',
    description: 'Done for today. Go be yourself.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#13111c',
    theme_color: '#13111c',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
