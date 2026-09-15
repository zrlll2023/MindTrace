<template>
  <div class="placeholder">
    <h2>{{ title }}</h2>
    <p>此页面将在后续任务中实现。</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<style scoped>
.placeholder { text-align: center; padding-top: 80px; color: var(--text-3); }
</style>
