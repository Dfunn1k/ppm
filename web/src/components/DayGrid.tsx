// El calendario de días (react-day-picker): va aparte para que solo se descargue al abrir una fecha.
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { es } from "react-day-picker/locale";

export default function DayGrid(props: DayPickerProps) {
  return <DayPicker locale={es} {...props} />;
}
