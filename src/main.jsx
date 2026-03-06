import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null, info: null }; }
  componentDidCatch(err, info) { this.setState({ err, info }); }
  render() {
    if (this.state.err) {
      return React.createElement("div", {
        style: { padding: 32, fontFamily: "monospace", background: "#1e1e2e", color: "#f38ba8", minHeight: "100vh" }
      },
        React.createElement("h2", null, "💥 Runtime Error"),
        React.createElement("pre", { style: { whiteSpace: "pre-wrap", color: "#cdd6f4", background: "#181825", padding: 16, borderRadius: 8 } },
          String(this.state.err) + "\n\n" + (this.state.info && this.state.info.componentStack ? this.state.info.componentStack : "")
        )
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(ErrorBoundary, null, React.createElement(App, null))
);
