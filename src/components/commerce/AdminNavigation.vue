<template>
  <nav class="admin-navigation" aria-label="运营管理导航">
    <RouterLink to="/admin/refunds">退款工作台</RouterLink>
    <RouterLink to="/admin/reconciliations">每日对账</RouterLink>
    <RouterLink to="/account/orders">返回我的订单 ↗</RouterLink>
  </nav>
</template>

<style scoped>
.admin-navigation { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 24px 0; }
a { color: var(--text-muted); padding: 8px 0; min-height: 44px; display: inline-flex; align-items: center; text-decoration: none; border-bottom: 2px solid transparent; }
a.router-link-exact-active { color: var(--text); border-color: var(--accent); }
a:hover { color: var(--text); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 5px; }
</style>
