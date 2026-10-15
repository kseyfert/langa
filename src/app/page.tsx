import { redirect } from 'next/navigation';

// Своего экрана у корня пока нет: тренажёр появится позже.
export default function Home() {
    redirect('/catalog');
}
