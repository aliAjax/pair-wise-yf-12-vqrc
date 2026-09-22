<script setup lang="ts">
import UnloadingPanel from "./business/UnloadingPanel.vue";

const stack = ["Vue3", "Vite", "TypeScript", "localStorage"];
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业前端最小闭环</p>
          <h1>油站网点 · 卸油差量索赔</h1>
          <p class="subtitle">
            一次到站登记油站、油品、单据量与实收量；差量超千分之五须填铅封编号与原因，复查确认后按实收入库。
          </p>
        </div>
        <div class="stack">
          <span v-for="item in stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <UnloadingPanel />
    </div>
  </main>
</template>
