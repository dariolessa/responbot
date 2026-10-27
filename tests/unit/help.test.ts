import { describe, expect, it } from "vitest"

import { navItems } from "@/components/layout/nav-items"
import { helpFor, helpTopics } from "@/lib/help"

describe("ayuda", () => {
  it("cada tema lleva a una pantalla que existe en el menú", () => {
    const hrefs = new Set(navItems.map((i) => i.href))
    for (const topic of helpTopics) {
      expect(topic.href && hrefs.has(topic.href.split("#")[0]!), topic.id).toBe(true)
    }
  })

  it("los ids de los temas no se repiten", () => {
    const ids = helpTopics.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("un profesional no ve lo que no puede tocar", () => {
    const staff = helpFor("staff")
    const ids = staff.topics.map((t) => t.id)
    expect(ids).toEqual(["agenda", "conversaciones", "clientes", "notificaciones"])
    expect(staff.gettingStarted).toHaveLength(0)
    expect(helpFor("admin").topics.some((t) => t.id === "facturacion")).toBe(false)
    expect(helpFor("owner").topics).toHaveLength(helpTopics.length)
  })
})
