import { cssInterop } from 'nativewind'
import Svg, { Circle, Path, type SvgProps } from 'react-native-svg'

// Let icons take Tailwind text color classes (className="text-muted") the
// same way hugeicons-react icons inherit currentColor on the desktop app.
cssInterop(Svg, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true }
  }
})

export type IconProps = Pick<SvgProps, 'color'> & {
  size?: number
  className?: string
}

type IconBaseProps = IconProps & { children: React.ReactNode }

function IconBase({ size = 24, color, className, children }: IconBaseProps): React.JSX.Element {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      color={color}
      className={className}
    >
      {children}
    </Svg>
  )
}

// Path data is taken verbatim from the Hugeicons free core set (CC0) — the
// exact icons wolffish-app renders through hugeicons-react.

export function ArrowDown01Icon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </IconBase>
  )
}

export function Tick02Icon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M5 14L8.5 17.5L19 6.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </IconBase>
  )
}

export function CheckmarkCircle02Icon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12Z"
        stroke="currentColor"
        strokeWidth={1.5}
      />
      <Path
        d="M8 12.5L10.5 15L16 9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </IconBase>
  )
}

export function Alert02Icon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M13.9248 21H10.0752C5.44476 21 3.12955 21 2.27636 19.4939C1.42317 17.9879 2.60736 15.9914 4.97574 11.9985L6.90057 8.75333C9.17559 4.91778 10.3131 3 12 3C13.6869 3 14.8244 4.91777 17.0994 8.75332L19.0243 11.9985C21.3926 15.9914 22.5768 17.9879 21.7236 19.4939C20.8704 21 18.5552 21 13.9248 21Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <Path
        d="M12 9V13.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <Path
        d="M12 16.9922V17.0022"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    </IconBase>
  )
}

export function InformationCircleIcon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Circle
        cx={12}
        cy={12}
        r={10}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <Path
        d="M12 16V11.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <Path
        d="M12 8.01172V8.00172"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    </IconBase>
  )
}

export function Cancel01Icon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M18 6L6.00081 17.9992M17.9992 18L6 6.00085"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </IconBase>
  )
}

export function ComputerIcon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M14 21H16M14 21C13.1716 21 12.5 20.3284 12.5 19.5V17L12 17M14 21H10M10 21H8M10 21C10.8284 21 11.5 20.3284 11.5 19.5V17L12 17M12 17V21"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <Path
        d="M16 3H8C5.17157 3 3.75736 3 2.87868 3.87868C2 4.75736 2 6.17157 2 9V11C2 13.8284 2 15.2426 2.87868 16.1213C3.75736 17 5.17157 17 8 17H16C18.8284 17 20.2426 17 21.1213 16.1213C22 15.2426 22 13.8284 22 11V9C22 6.17157 22 4.75736 21.1213 3.87868C20.2426 3 18.8284 3 16 3Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </IconBase>
  )
}

export function Moon02Icon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M21.5 14.0784C20.3003 14.7189 18.9301 15.0821 17.4751 15.0821C12.7491 15.0821 8.91792 11.2509 8.91792 6.52485C8.91792 5.06986 9.28105 3.69968 9.92163 2.5C5.66765 3.49698 2.5 7.31513 2.5 11.8731C2.5 17.1899 6.8101 21.5 12.1269 21.5C16.6849 21.5 20.503 18.3324 21.5 14.0784Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </IconBase>
  )
}

export function Sun03Icon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M17 12C17 14.7614 14.7614 17 12 17C9.23858 17 7 14.7614 7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12Z"
        stroke="currentColor"
        strokeWidth={1.5}
      />
      <Path
        d="M12 2V3.5M12 20.5V22M19.0708 19.0713L18.0101 18.0106M5.98926 5.98926L4.9286 4.9286M22 12H20.5M3.5 12H2M19.0713 4.92871L18.0106 5.98937M5.98975 18.0107L4.92909 19.0714"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={1.5}
      />
    </IconBase>
  )
}

export function EyeIcon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M2 8C2 8 6.47715 3 12 3C17.5228 3 22 8 22 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={1.5}
      />
      <Path
        d="M21.544 13.045C21.848 13.4713 22 13.6845 22 14C22 14.3155 21.848 14.5287 21.544 14.955C20.1779 16.8706 16.6892 21 12 21C7.31078 21 3.8221 16.8706 2.45604 14.955C2.15201 14.5287 2 14.3155 2 14C2 13.6845 2.15201 13.4713 2.45604 13.045C3.8221 11.1294 7.31078 7 12 7C16.6892 7 20.1779 11.1294 21.544 13.045Z"
        stroke="currentColor"
        strokeWidth={1.5}
      />
      <Path
        d="M15 14C15 12.3431 13.6569 11 12 11C10.3431 11 9 12.3431 9 14C9 15.6569 10.3431 17 12 17C13.6569 17 15 15.6569 15 14Z"
        stroke="currentColor"
        strokeWidth={1.5}
      />
    </IconBase>
  )
}

export function ViewOffIcon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M22 8C22 8 18 14 12 14C6 14 2 8 2 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={1.5}
      />
      <Path
        d="M15 13.5L16.5 16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <Path
        d="M20 11L22 13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <Path
        d="M2 13L4 11"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <Path
        d="M9 13.5L7.5 16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </IconBase>
  )
}

export function GlobalIcon(props: IconProps): React.JSX.Element {
  return (
    <IconBase {...props}>
      <Path
        d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12Z"
        stroke="currentColor"
        strokeWidth={1.5}
      />
      <Path
        d="M20 5.69899C19.0653 5.76636 17.8681 6.12824 17.0379 7.20277C15.5385 9.14361 14.039 9.30556 13.0394 8.65861C11.5399 7.6882 12.8 6.11636 11.0401 5.26215C9.89313 4.70542 9.73321 3.19045 10.3716 2"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <Path
        d="M2 11C2.7625 11.6621 3.83046 12.2682 5.08874 12.2682C7.68843 12.2682 8.20837 12.7649 8.20837 14.7518C8.20837 16.7387 8.20837 16.7387 8.72831 18.2288C9.06651 19.1981 9.18472 20.1674 8.5106 21"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
      <Path
        d="M22 13.4523C21.1129 12.9411 20 12.7308 18.8734 13.5405C16.7177 15.0898 15.2314 13.806 14.5619 15.0889C13.5765 16.9775 17.0957 17.5711 14 22"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </IconBase>
  )
}
