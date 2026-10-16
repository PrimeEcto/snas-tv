import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {FocusScope, useFocusNode} from '../src/ui/focus';
import {requestFocus} from 'snas-focus';
jest.mock('react-native', () => ({
  View: 'View',
  BackHandler: {addEventListener: () => ({remove: () => {}})},
}));
jest.mock('snas-focus', () => ({requestFocus: jest.fn()}), {virtual: true});
function Control({id}: {id: string}) {
  const node = useFocusNode(id);
  return React.createElement('Target', {
    ref: node.ref,
    testID: id,
    onFocus: node.remember,
  });
}
const screen = (active: boolean) => (
  <FocusScope active={active} initial="first">
    <Control id="first" />
    <Control id="settings" />
  </FocusScope>
);
(global as any).IS_REACT_ACT_ENVIRONMENT = true;
test('restoration survives Android assigning temporary focus to the first child', async () => {
  jest.useFakeTimers();
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(screen(true), {
      createNodeMock: (element) => ({id: element.props.testID}),
    });
  });
  await act(async () => jest.advanceTimersByTime(140));
  await act(async () =>
    renderer!.root.findByProps({testID: 'settings'}).props.onFocus(),
  );
  await act(async () => renderer!.update(screen(false)));
  await act(async () => renderer!.update(screen(true)));
  // Android can choose the first native child while a previously hidden view attaches.
  await act(async () =>
    renderer!.root.findByProps({testID: 'first'}).props.onFocus(),
  );
  await act(async () => jest.advanceTimersByTime(140));
  expect(jest.mocked(requestFocus).mock.calls.at(-1)?.[0]).toEqual({
    id: 'settings',
  });
  await act(async () => renderer!.unmount());
  jest.useRealTimers();
});
