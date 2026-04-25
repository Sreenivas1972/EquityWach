import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");
const windowType = params.get("window");

const RootComponent = App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);
