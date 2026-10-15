import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { User } from '@/components/User';
import '@/styles/base.css';
import '@/styles/App.css';

export const metadata: Metadata = { title: 'langa' };

// Пользователь один и без входа — имя зашито, пока не появятся аккаунты.
const USER_NAME = 'Kesha';

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="ru">
            <body>
                <div className="app">
                    <header className="topbar">
                        <Nav />
                        <User name={USER_NAME} />
                    </header>
                    <main>{children}</main>
                </div>
            </body>
        </html>
    );
}
