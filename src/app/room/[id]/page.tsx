import { RoomScreen } from "@/components/room-screen";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <RoomScreen id={(await params).id} />;
}
