# 🎨 G-Code Art Generator: Next-Gen Vector Toolpaths

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Technology](https://img.shields.io/badge/tech-Three.js%20|%20TailwindCSS-orange)
![Category](https://img.shields.io/badge/category-3D%20Printing%20/Art-green)

A high-performance, web-based tool designed to transform images into artistic, FDM-ready G-code.

---

## 🚀 Key Features

* **Path-Based Art Algorithms**: Generate complex toolpaths using **Hilbert Curves**, **Spirals**, and **Variable-Density Zigzags**.
* **FDM-Native Logic**: Unlike standard vectorizers, this tool calculates real-time extrusion volume ($E$ values), handles flow compensation, and manages Z-hops for a clean, string-free finish.
* **Optimized for AMS**: 
    * Built-in **AMS slot selection** and `M600` filament change logic.
* **3D Toolpath Preview**: Integrated **Three.js** engine provides an accurate 3D visualization of the print before exporting.
* **One-Click Base Generation**: Automatically creates a structural base (circular or rectangular) to support the artwork, making the output ready to print immediately.
* **Client-Side Processing**: 100% browser-based. Your images never leave your computer.

## 🛠 Technical Highlights

The generator processes image luma data to modulate toolpath parameters:
- **Variable Line Width**: Thicker extrusions in darker areas for high-contrast results.
- **Dynamic Resolution**: Adaptive path density based on image complexity.
- **G-Code Templating**: Custom header/footer injection for specific printer profiles.

## 📦 Getting Started

1.  **Host it anywhere**: Simply upload `index.html`, `script.js`, and `styles.css` to any static hosting (GitHub Pages, Vercel, Netlify).
2.  **G-Code Template**: Load your custom gcode template.
3.  **Load an Image**: load any PNG/JPG.
4.  **Select Algorithm**: Choose between Hilbert, Spiral, or Zigzag.
5.  **Configure Multi-Material**: Define toolheads (T0/T1) for the base and the artwork.
6.  **Generate & Print**: Export the optimized `.gcode` file.

---

## 🤝 Collaboration & Licensing

Free personal use, for commercial use see below.
I am currently looking for partnerships to integrate this technology into established 3D printing ecosystems (Printables, MakerLab, etc.). 

**Special Interest**: I am open to providing full source code and integration support in exchange for development hardware.

**Contact me**: carlobalde@gmail.com

---


*Developed with ❤️ for the 3D Printing Community.*
