import { AssetQrView } from '@/components/AssetQrView.tsx';

export const metadata = {
  title: 'Garage asset',
  robots: { index: false, follow: false },
};

export default function AssetQrPage() {
  return <AssetQrView />;
}
