import { redirect } from 'next/navigation';

// redirect() tidak menambahkan basePath secara otomatis
export default function Home() {
  redirect(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/user`);
}
