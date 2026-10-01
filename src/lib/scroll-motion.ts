import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/** Native scroll choreography; works with the app's internal scrolling main. */
export function useScrollMotion(root: Ref<HTMLElement | undefined>) {
  let observer: IntersectionObserver | null = null
  let preference: MediaQueryList | null = null
  let raf = 0
  function update() {
    raf = 0
    if (!root.value || preference?.matches) return
    root.value.querySelectorAll<HTMLElement>('[data-scroll-stage]').forEach(element => {
      const rect = element.getBoundingClientRect()
      const progress = Math.min(1, Math.max(0, (innerHeight - rect.top) / (innerHeight + rect.height)))
      element.style.setProperty('--scroll-progress', String(progress))
    })
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(update) }
  function configure() {
    if (!root.value) return
    observer?.disconnect()
    if (preference?.matches) {
      root.value.classList.remove('motion-ready')
      root.value.querySelectorAll<HTMLElement>('[data-reveal]').forEach(element => element.classList.add('is-revealed'))
      root.value.querySelectorAll<HTMLElement>('[data-scroll-stage]').forEach(element => element.style.setProperty('--scroll-progress', '.5'))
      return
    }
    root.value.classList.add('motion-ready')
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-revealed'); observer?.unobserve(entry.target) } })
    }, { threshold: .08 })
    root.value.querySelectorAll('[data-reveal]').forEach(element => observer!.observe(element))
    schedule()
  }
  onMounted(() => {
    preference = matchMedia('(prefers-reduced-motion: reduce)')
    preference.addEventListener('change', configure)
    document.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule, { passive: true })
    configure()
  })
  onBeforeUnmount(() => {
    observer?.disconnect(); cancelAnimationFrame(raf)
    preference?.removeEventListener('change', configure)
    document.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
  })
}
