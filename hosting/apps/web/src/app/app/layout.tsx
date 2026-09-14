import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { MarketingShell } from '@/components/marketing/Shell';
import './dashboard.css';

export const metadata: Metadata = {
  title: 'Личный кабинет | ohmy-seo',
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <MarketingShell><div className="dashboard">{children}</div></MarketingShell>;
}
