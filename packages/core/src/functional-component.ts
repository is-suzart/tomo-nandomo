import { defineComponent, type DefinedComponentRef, type SetupContext } from './define-component.js';

/** Lazy functional component: one execution and one owned scope per mounted instance.
 * Pass reactive values as getters; props are not proxies and rendering does not rerun.
 */
export function component<P extends object>(name: string, render: (props: P, lifecycle: SetupContext) => unknown): (props: P) => DefinedComponentRef {
  return props => defineComponent({
    name,
    setup: lifecycle => ({ tree: render(props, lifecycle) }),
    views: {
      html: state => state.tree,
      qml: state => state.tree,
      gtk: state => state.tree,
      compose: state => state.tree,
    },
  })({});
}
