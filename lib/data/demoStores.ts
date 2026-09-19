export type DemoStore = {
  id: string;
  name: string;
};

export const DEMO_STORES: readonly DemoStore[] = [
  {
    id: "57181130-4449-4299-a864-25a2098147e4",
    name: "이수점",
  },
  {
    id: "f9bc865b-5722-40b3-8548-1c181f5ad7fb",
    name: "숭실대점",
  },
];

export function findDemoStore(storeId: string): DemoStore | undefined {
  return DEMO_STORES.find((store) => store.id === storeId);
}