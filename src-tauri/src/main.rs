// Evita la consola adicional en Windows en release. NO QUITAR.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sedapalgis_lib::run();
}
