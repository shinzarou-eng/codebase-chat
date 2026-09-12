import express from "express";
import { PORT } from "./config.js";
import { login, verifyToken } from "./auth.js";
import { listPets, getPet, addPet } from "./pets.js";

const app = express();
app.use(express.json());

app.post("/login", (req, res) => {
  const session = login(req.body.userId, req.body.password);
  if (!session) return res.status(401).json({ error: "invalid credentials" });
  res.json({ token: session.token });
});

app.get("/pets", (req, res) => {
  const session = verifyToken(req.headers.authorization ?? "");
  if (!session) return res.status(401).json({ error: "unauthorized" });
  res.json(listPets());
});

app.get("/pets/:id", (req, res) => {
  const pet = getPet(Number(req.params.id));
  if (!pet) return res.status(404).json({ error: "not found" });
  res.json(pet);
});

app.post("/pets", (req, res) => {
  res.status(201).json(addPet(req.body));
});

app.listen(PORT, () => {
  console.log(`petstore listening on :${PORT}`);
});
