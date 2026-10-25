import { Route, Routes } from "react-router";

import { Estado } from "./pages/Estado";

// Las pantallas de acceso llegan en el siguiente paso; por ahora, una sola página de estado
export function App() {
  return (
    <Routes>
      <Route path="*" element={<Estado />} />
    </Routes>
  );
}
