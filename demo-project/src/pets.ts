export interface Pet {
  id: number;
  name: string;
  species: "dog" | "cat" | "bird";
  vaccinated: boolean;
}

const pets: Pet[] = [
  { id: 1, name: "Rex", species: "dog", vaccinated: true },
  { id: 2, name: "Milo", species: "cat", vaccinated: false },
];

export function listPets(): Pet[] {
  return pets;
}

export function getPet(id: number): Pet | undefined {
  return pets.find((p) => p.id === id);
}

// FIXME: validate input shape instead of trusting any
export function addPet(raw: any): Pet {
  const pet: Pet = {
    id: pets.length + 1,
    name: raw.name,
    species: raw.species,
    vaccinated: Boolean(raw.vaccinated),
  };
  pets.push(pet);
  return pet;
}
